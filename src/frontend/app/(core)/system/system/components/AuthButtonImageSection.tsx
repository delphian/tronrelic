'use client';

/**
 * @fileoverview Sign-in button image section.
 *
 * Lets an administrator replace the header's "Sign in" button with an image,
 * such as the site mascot, without a code change or a redeploy. The image is
 * chosen through the platform file picker, so it can be uploaded on the spot
 * or picked from files already uploaded, and saving it changes the header on
 * the next page load.
 *
 * The picker is delivered by whichever files-provider plugin is enabled. When
 * none is, the card still shows the current image and can remove it, and says
 * why choosing a new one is unavailable.
 *
 * Like its sibling cards on this tab, the section fetches on mount rather than
 * receiving server-rendered data. The tab mounts only once an administrator
 * selects it, so there is no server-rendered markup for the first client render
 * to disagree with.
 */

import { useCallback, useEffect, useState } from 'react';
import { ImageIcon, Save, Trash2, UserRound } from 'lucide-react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { Stack } from '../../../../../components/layout';
import { useToast } from '../../../../../components/ui/ToastProvider/ToastProvider';
import { useFilePicker } from '../../../../../lib/filePickerRegistry';
import {
    getAuthButtonImage,
    updateAuthButtonImage,
    type IAuthButtonImageView
} from './auth-button-image-api';
import providerStyles from './ProviderSection.module.scss';
import styles from './AuthButtonImageSection.module.scss';

/** The state meaning "no image set", used before the first read and after Remove. */
const NO_IMAGE: IAuthButtonImageView = { authButtonImageUrl: null, authButtonImageFileId: null };

/**
 * Render the sign-in button image card.
 *
 * @returns The card, or a placeholder line while the first fetch is in flight.
 */
export function AuthButtonImageSection() {
    const [draft, setDraft] = useState<IAuthButtonImageView>(NO_IMAGE);
    const [saved, setSaved] = useState<IAuthButtonImageView>(NO_IMAGE);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const { push: pushToast } = useToast();
    const { pick, isAvailable: pickerAvailable } = useFilePicker();

    /**
     * Load the stored image when the card mounts.
     *
     * The `active` flag stops a response that arrives after the admin has left
     * the tab from writing into an unmounted component.
     */
    useEffect(() => {
        let active = true;

        getAuthButtonImage()
            .then((view) => {
                if (active) {
                    setDraft(view);
                    setSaved(view);
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    pushToast({
                        tone: 'danger',
                        title: 'Failed to load the sign-in button image',
                        description: error instanceof Error ? error.message : 'Unknown error'
                    });
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [pushToast]);

    /**
     * Open the file picker and put the chosen image in the draft.
     *
     * The picker's `accept` list is only a hint to the provider, so the
     * returned MIME type is checked here as well. Both the URL and the file id
     * are kept, because the backend stores them as one setting.
     */
    const choose = useCallback(async () => {
        const selection = await pick({ accept: ['image/*'], title: 'Choose the sign-in button image' });

        if (selection && selection.mimeType.startsWith('image/')) {
            setDraft({ authButtonImageUrl: selection.url, authButtonImageFileId: selection.fileId });
        } else if (selection) {
            pushToast({
                tone: 'danger',
                title: 'That file is not an image',
                description: `${selection.name} is ${selection.mimeType}. Choose a PNG, JPEG, WebP, or SVG file.`
            });
        }
    }, [pick, pushToast]);

    /**
     * Clear the draft so that saving puts the default text button back.
     */
    const remove = useCallback(() => {
        setDraft(NO_IMAGE);
    }, []);

    /**
     * Save the draft and adopt whatever the backend stored.
     *
     * The response rather than the draft becomes the saved state, because the
     * backend is the authority on what was written and trims the values.
     */
    const handleSave = useCallback(async () => {
        setSaving(true);

        try {
            const next = await updateAuthButtonImage(draft);
            setDraft(next);
            setSaved(next);
            pushToast({
                tone: 'success',
                title: next.authButtonImageUrl ? 'Sign-in button image saved' : 'Sign-in button image removed',
                description: 'The header shows the change on the next page load.'
            });
        } catch (error) {
            pushToast({
                tone: 'danger',
                title: 'Failed to save the sign-in button image',
                description: error instanceof Error ? error.message : 'Unknown error'
            });
        } finally {
            setSaving(false);
        }
    }, [draft, pushToast]);

    const previewUrl = draft.authButtonImageUrl;
    const dirty = draft.authButtonImageUrl !== saved.authButtonImageUrl
        || draft.authButtonImageFileId !== saved.authButtonImageFileId;
    let content;

    if (loading) {
        content = (
            <Card padding="sm" noBackgroundImage>
                <span className="text-muted">Loading sign-in button image…</span>
            </Card>
        );
    } else {
        content = (
            <Card padding="sm" noBackgroundImage>
                <Stack gap="md">
                    <div className={providerStyles.provider_header}>
                        <UserRound size={16} aria-hidden style={{ color: 'var(--color-primary)' }} />
                        <h3 className={providerStyles.provider_title}>Sign-in button image</h3>
                        {saved.authButtonImageUrl
                            ? <Badge tone="success">Image set</Badge>
                            : <Badge tone="neutral">Default button</Badge>}
                    </div>

                    <p className="text-muted">
                        Replaces the &quot;Sign in&quot; button in the site header with a round image, such as the site
                        mascot. Visitors who are signed out open the sign-in dialog when they click it, and visitors
                        who are signed in go to their profile. A square image with a transparent background works best,
                        at least 96 pixels on each side so it stays sharp on high-density screens.
                    </p>

                    <div className={styles.preview_row}>
                        <div className={styles.preview}>
                            {previewUrl
                                ? (
                                    // Plain <img> is the project's convention for uploaded images.
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={previewUrl} alt="Preview of the sign-in button image" className={styles.preview_img} />
                                )
                                : <UserRound size={24} aria-hidden />}
                        </div>
                        <span className={providerStyles.hint}>
                            {previewUrl
                                ? 'This is how the image is framed in the header. Save to publish it.'
                                : 'No image is set, so the header shows the default "Sign in" button.'}
                            {dirty && ' You have unsaved changes.'}
                        </span>
                    </div>

                    {!pickerAvailable && (
                        <span className={providerStyles.hint}>
                            No files provider is enabled, so an image cannot be chosen right now. Enable the Files
                            plugin under System, then Plugins, to upload or choose one.
                        </span>
                    )}

                    <div className={providerStyles.actions}>
                        <Button
                            variant="secondary"
                            size="md"
                            onClick={() => void choose()}
                            disabled={!pickerAvailable || saving}
                            icon={<ImageIcon size={18} />}
                        >
                            Choose image
                        </Button>
                        <Button
                            variant="ghost"
                            size="md"
                            onClick={remove}
                            disabled={!draft.authButtonImageUrl || saving}
                            icon={<Trash2 size={18} />}
                        >
                            Remove image
                        </Button>
                        <Button
                            variant="primary"
                            size="md"
                            onClick={() => void handleSave()}
                            disabled={!dirty || saving}
                            loading={saving}
                            icon={<Save size={18} />}
                        >
                            Save
                        </Button>
                    </div>
                </Stack>
            </Card>
        );
    }

    return content;
}
