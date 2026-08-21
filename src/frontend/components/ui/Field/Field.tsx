'use client';

import { Fragment, cloneElement, isValidElement, useEffect, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../../lib/cn';
import styles from './Field.module.css';

/**
 * The props Field injects into the control it wraps, when it can reach one.
 *
 * Both are attributes the caller would otherwise have to remember on every
 * control: the id of the message describing it, and the fact that a value is
 * demanded. Declaring them here lets the clone below be type-checked against
 * what it actually writes, rather than casting to `any`.
 */
interface IInjectedChildProps {
    'aria-describedby'?: string;
    'aria-required'?: boolean;
    /**
     * Read as well as written: the field adopts an id the control already
     * carries before generating one, so the label points at the control the
     * caller already named rather than renaming it.
     */
    id?: string;
}

/**
 * Messages already warned about, so a misconfigured field reports itself once
 * instead of on every render.
 *
 * A field is re-rendered on every keystroke of a controlled form, twice per
 * commit under StrictMode, and again on the server during rendering. A bare
 * `console.warn` in the render body therefore repeats the same line hundreds of
 * times and buries whatever else the developer was reading. Module scope rather
 * than a ref because the point is to report a mistake once, not once per
 * mounted copy of the same misconfigured field.
 */
const warnedMessages = new Set<string>();

/**
 * Report a wiring mistake to the developer who can fix it, at most once per
 * distinct message.
 *
 * Field's accessibility wiring fails silently by nature: a label with nothing to
 * point at still renders and still looks right, so nothing on screen reveals the
 * problem and only a screen reader would. A development warning is what turns
 * that into something noticeable at the point of use.
 *
 * @param key What counts as "the same mistake". Kept separate from the message
 *            so the message can name a generated id without that id becoming
 *            part of the key — ids from `useId` differ per instance and per
 *            mount, so keying on one would warn once per field and again after
 *            every remount, which is the flood this is here to stop, while
 *            growing the set without bound.
 * @param message What is wrong and what the caller should pass instead.
 * @returns Nothing; the effect is the console line.
 */
const warnOnce = (key: string, message: string): void => {
    if (process.env.NODE_ENV !== 'production' && !warnedMessages.has(key)) {
        warnedMessages.add(key);
        console.warn(message);
    }
};

/**
 * Decide whether a piece of caller-supplied content would draw nothing on
 * screen, so the field can leave out the element that would have held it.
 *
 * This exists because the `condition && <span/>` idiom is how callers write an
 * optional label or hint, and it yields `false` rather than `undefined` when the
 * condition fails. React draws `false` as nothing, so a naive `!= null` test
 * sees content that is not there: the field then emits an empty `<label>` that
 * contributes vertical space and no accessible name, or an empty hint element
 * that `aria-describedby` points the control at, handing a screen reader an
 * empty description. Blank and whitespace-only strings are treated the same way,
 * matching how an empty `error` entry is filtered out.
 *
 * Numbers are deliberately not filtered — `0` is real content and renders as
 * "0", so a field labelled `0` keeps its label.
 *
 * @param value The label, hint, or other content the caller passed, exactly as
 *              given, so this helper sees the same `false` React would.
 * @returns True when there is nothing to draw and the surrounding element
 *          should be omitted rather than rendered empty.
 */
const rendersNothing = (value: ReactNode): boolean => {
    const result =
        value === undefined ||
        value === null ||
        typeof value === 'boolean' ||
        (typeof value === 'string' && value.trim().length === 0);

    return result;
};

/**
 * FieldProps defines the properties available for the Field component.
 *
 * A field is a label, a control, and a line of text about that control — either
 * standing guidance or the reason the current value was refused. The props are
 * named for those three parts rather than for the markup, because a caller
 * should not have to know which element carries which ARIA attribute.
 */
export interface FieldProps {
    /**
     * The control this field wraps: an `<Input>`, `<Select>`, `<Textarea>`, or
     * any other form control.
     *
     * Taken as children rather than built from a `type` prop, so a field can
     * hold a control this component has never heard of — an address selector, a
     * date picker, two controls belonging to one label — without Field growing a
     * branch for each. Pass a single element where you can: that is the case
     * Field can wire `aria-describedby` into (see {@link Field}).
     *
     * A custom component here must forward `id`, `aria-describedby`, and
     * `aria-required` through to the DOM element it renders. Field clones the
     * child to set them, so a component that accepts only its own named props
     * and drops the rest swallows them: the label ends up naming an id that is
     * in no element, and the message is referenced by nothing. Nothing on
     * screen shows this, and no warning can catch it, because from Field's side
     * the props were passed successfully. `AccountPicker` and `AddressSelector`
     * in this repository are two components that do not currently forward them
     * — give those an `aria-label` and pass `htmlFor` rather than relying on
     * this wiring.
     */
    children: ReactNode;

    /**
     * The visible label. Omit it where the surrounding layout already names the
     * control, such as a dense inline row where a repeated label would be noise
     * — but then give the control its own `aria-label`, because a control with
     * no accessible name is unusable with a screen reader.
     */
    label?: ReactNode;

    /**
     * Standing guidance shown under the control: the format expected, or what
     * the value will be used for. Shown only while there is no `error`, so the
     * reader is never left working out which of two lines applies to them now.
     *
     * A hint that renders to nothing — `false` from a `condition && ...`
     * expression, or a blank string — counts as no hint, so the field does not
     * describe the control with an empty message.
     */
    hint?: ReactNode;

    /**
     * Why the current value was refused. A string renders as one line; an array
     * renders one line per problem, so a value with two faults can be fixed in a
     * single edit rather than one round trip per fault.
     *
     * This does **not** restyle the control — set `invalid` on the control
     * itself. The two are separate because a field can carry a message about
     * something other than the control's own value, such as two dates that are
     * each fine and wrong together.
     */
    error?: string | readonly string[];

    /**
     * Marks the field as required: an asterisk appears after the label, and
     * `aria-required` is set on the wrapped control so a screen reader
     * announces the requirement when the control takes focus.
     *
     * The asterisk itself is hidden from assistive technology, because a screen
     * reader would otherwise read it as stray punctuation. The announcement
     * comes from the control instead. This sets `aria-required` only, never the
     * native `required` attribute, so turning it on does not switch the
     * browser's own form validation on behind the caller's back — set
     * `required` on the control as well when you want that.
     *
     * Because the announcement travels on the control, this needs children to
     * be a single element Field can reach. With a fragment or several controls
     * there is nowhere to put the attribute, so set `required` on the control
     * yourself; a development warning says so if you hit that case.
     *
     * The asterisk lives inside the label, so `required` with no `label` sets
     * `aria-required` and shows nothing: a screen-reader user learns the field
     * is required and a sighted user does not. That is accepted rather than
     * worked around, because a field with no label is a dense row where a bare
     * asterisk would have nothing to attach to and would read as noise. Carry
     * the requirement in the surrounding copy in that case.
     *
     * @default false
     */
    required?: boolean;

    /**
     * Extra classes for the field wrapper, which is the element that owns the
     * layout — so a width or a grid placement belongs here rather than on the
     * control.
     */
    className?: string;

    /**
     * The wrapped control's `id`, so the label can point at it.
     *
     * Optional, and never written onto the control. This value names an element
     * the caller has already decided about, and that element may be nested
     * inside the child rather than being the child — so Field points the label
     * at it and leaves placing it to you. Put the id on that element yourself.
     *
     * Field assigns only an id it generated itself, and only to a single-element
     * child carrying none. So leave this out for an ordinary single control and
     * the association happens on its own; pass it when children is a fragment,
     * several controls, or a wrapper around them, where Field cannot tell which
     * element the label belongs to. A development check after mounting reports
     * a label left pointing at an id no element has.
     */
    htmlFor?: string;
}

/**
 * Field Component
 *
 * Wraps a form control with its label and its message, and does the ARIA wiring
 * between them once. Before this existed, every surface wanting to explain a
 * refused value hand-rolled the same three things — a message element, an id
 * pointing at it, and an `aria-describedby` on the control — and most skipped
 * the last two, so the explanation was visible on screen and never announced.
 *
 * It is a wrapper rather than an `error` prop on `<Input>` deliberately. A
 * control is frequently a flex or grid item, and growing a wrapper only when a
 * prop is set would make the same component render two different layouts
 * depending on that prop. Keeping the structure here also means one
 * implementation serves `<Input>`, `<Select>`, `<Textarea>`, and anything else,
 * rather than each primitive carrying a copy.
 *
 * **How the message reaches the control.** Field clones its child to add
 * `aria-describedby`, merging with any value the child already carries. That
 * works when children is one element, which is the ordinary case. When it is a
 * fragment, a list, or plain text, the message still renders and still reads
 * correctly on screen, but nothing is injected — so pass `aria-describedby`
 * yourself if you need it in that shape.
 *
 * **How the message gets announced.** The message element is always rendered
 * and always carries `aria-live="polite"`, even when it is empty. That looks
 * wasteful and is not: a live region only announces content that changes after
 * the region is already in the accessibility tree, so mounting the region
 * together with its first message — which is what a first validation failure
 * would do — is the one case screen readers stay silent for. Polite rather than
 * assertive, because these messages typically change on every keystroke and an
 * assertive region would interrupt mid-word.
 *
 * **Width.** The field stretches its control to the field's own width. For an
 * `<Input>` or `<Textarea>` that is what a form wants, but it does override
 * `<Select>`'s intrinsic width, so a dropdown that sized itself to its options
 * outside a field will fill the field inside one. Set the width on the field
 * itself through `className` when that is not what you want.
 *
 * @example
 * ```tsx
 * const defects = validate(name);
 *
 * <Field
 *     label="Subject name"
 *     htmlFor="subject-name"
 *     hint="Lowercase letters, digits, - and _"
 *     error={defects}
 * >
 *     <Input
 *         id="subject-name"
 *         value={name}
 *         onChange={(e) => setName(e.target.value)}
 *         invalid={defects.length > 0}
 *     />
 * </Field>
 * ```
 *
 * @param props - Field properties: the control as children, plus its label,
 * hint, error, and required state.
 * @returns The control wrapped with whichever of the label and message parts the
 * caller supplied, with the two associated to it.
 */
export function Field({
    children,
    label,
    hint,
    error,
    required = false,
    className,
    htmlFor
}: FieldProps) {
    // Called unconditionally, as hooks must be. It is the last resort for the
    // label/control association, used only when neither the caller nor the
    // control itself names an id.
    const generatedId = useId();

    // Only a single element child can be inspected or cloned. A fragment is a
    // valid element but cannot carry DOM attributes, so it is excluded here
    // rather than cloned into a React warning.
    const child =
        isValidElement(children) && children.type !== Fragment
            ? (children as ReactElement<IInjectedChildProps>)
            : null;

    // The id the label points at. An id the control already carries wins,
    // because that one is certain to exist in the DOM; `htmlFor` is used only
    // when the control names no id of its own, and a generated id only when
    // neither does. Preferring `htmlFor` instead would break the case where a
    // caller passes one value and gives the control a different id: nothing is
    // written over an id the control already has, so the label would point at
    // an element that does not exist. That fails silently — the label renders,
    // looks correct, and names nothing.
    //
    // Only the generated branch is ever written back onto the child; see the
    // injection below for why a caller-supplied `htmlFor` must not be.
    const controlId = child?.props.id ?? htmlFor ?? generatedId;
    const hintId = `${controlId}-hint`;
    const errorId = `${controlId}-error`;

    // An empty string and an empty array both mean "nothing is wrong". Without
    // this filter the ordinary `error={message}` shape — where `message` is ''
    // while the value is fine — reads as one error: the field turns danger
    // coloured, renders an alert icon with no text beside it, and suppresses
    // the hint for exactly as long as the field is valid.
    const errors = (typeof error === 'string' ? [error] : (error ?? [])).filter(
        (line) => line.trim().length > 0
    );
    const hasError = errors.length > 0;
    // The hint is suppressed while an error stands rather than shown beside it.
    // Two lines under one control leaves the reader deciding which one applies,
    // and the error is always the more urgent of the two.
    const showHint = !hasError && !rendersNothing(hint);
    const hasLabel = !rendersNothing(label);
    const describedById = hasError ? errorId : showHint ? hintId : undefined;

    // Whether the label may point at a control at all.
    //
    // The full contract this has to satisfy: a rendered `htmlFor` must always
    // name an element that exists. Enumerating the states — a reachable child
    // carrying its own id uses that id; a reachable child without one is given
    // `controlId` below, whether that came from `htmlFor` or was generated; an
    // unreachable child (a fragment, an array, plain text) with `htmlFor` set
    // trusts the caller to have put that id on a control; and an unreachable
    // child with no `htmlFor` has no id anywhere, which is this flag's only
    // false case. Emitting `controlId` in that last state would point the label
    // at a generated id present nowhere in the document — a label that renders,
    // looks correct, and names nothing. Leaving `htmlFor` off is the honest
    // outcome, and the warning below tells the developer to supply one.
    const canAssociateLabel = child !== null || htmlFor !== undefined;

    // Both of the ways this field can fail without showing it. An unreachable
    // child is the root cause of each: nothing can be injected into it, so the
    // label has nothing to name and `aria-required` has nowhere to go. They are
    // reported separately because they have different remedies — one is fixed
    // by passing `htmlFor`, the other only by restructuring the children or
    // setting the attribute by hand.
    const unreachable = `[Field${typeof label === 'string' ? ` "${label}"` : ''}] `;

    if (hasLabel && !canAssociateLabel) {
        warnOnce(
            `${unreachable}unassociable-label`,
            unreachable +
                'A label was given, but children is not a single element Field can reach ' +
                '(a fragment, an array, or plain text) and no htmlFor was passed. The label ' +
                'cannot be associated with any control, so it names nothing to a screen ' +
                'reader. Pass htmlFor with the id of the control it names.'
        );
    }

    if (required && child === null) {
        warnOnce(
            `${unreachable}unreachable-required`,
            unreachable +
                'required was set, but children is not a single element Field can reach, so ' +
                'aria-required could not be applied to any control. The asterisk is hidden ' +
                'from assistive technology by design, so nothing tells a screen-reader user ' +
                'the field is required. Set required or aria-required on the control itself.'
        );
    }

    /**
     * Check after mounting that the label actually points at something.
     *
     * The two warnings above catch what can be decided from the props alone,
     * which is not the whole problem. Two shapes get past them and fail in
     * exactly the same silent way — the label renders, looks right, and names
     * nothing. A caller can pass `htmlFor` naming an id that is on no element,
     * since Field deliberately never writes a caller's id onto the child. And a
     * custom component can accept only its own named props and quietly drop the
     * `id` Field cloned onto it, which no amount of inspecting the element
     * beforehand would reveal.
     *
     * Looking the id up in the document after the commit settles both, because
     * by then the answer is a fact rather than a prediction. Development only,
     * and skipped when the render-time warning already fired, so one mistake is
     * reported once.
     */
    useEffect(() => {
        if (process.env.NODE_ENV === 'production' || !hasLabel || !canAssociateLabel) {
            return;
        }

        if (!document.getElementById(controlId)) {
            warnOnce(
                // The id is reported in the message but kept out of the key: a
                // generated one differs per field and per mount, so including
                // it would warn once for every affected field and again on
                // every remount.
                `${unreachable}dangling-label-target`,
                unreachable +
                    `The label points at id "${controlId}", but no element in the document ` +
                    'has it. Either htmlFor names an id that is on nothing — Field never ' +
                    'writes a caller-supplied id onto the control, because the control may ' +
                    'not be the element that should carry it — or the wrapped component does ' +
                    'not forward the id it was given to a DOM node. Put the id on the control ' +
                    'yourself, or give the control an aria-label and drop the label prop.'
            );
        }
    }, [hasLabel, canAssociateLabel, controlId, unreachable]);

    /**
     * Attach the message, the required state, and the label's id to the control,
     * so assistive technology reads them together with the control rather than
     * as loose text nearby.
     *
     * Only a single element child can be reached this way. Anything else — a
     * fragment, an array, several controls, plain text — is returned untouched
     * rather than guessed at, because injecting the attribute into the first of
     * several controls would describe the wrong one, which is worse than
     * describing none. Note this has to be tested with `isValidElement`
     * directly: counting the children first and then unwrapping with
     * `Children.only` would throw on a plain-text or single-element-array child
     * instead of falling through to the untouched case, which is a crash rather
     * than the degradation described above.
     *
     * @returns The child with whichever of `aria-describedby`, `aria-required`,
     * and `id` this field's own props call for, or the child exactly as given
     * when there is nothing to add or no single element to add it to.
     */
    const describedChildren = (): ReactNode => {
        let described: ReactNode = children;

        if (child) {
            const injected: IInjectedChildProps = {};

            if (describedById) {
                const existing = child.props['aria-describedby'];
                injected['aria-describedby'] = existing
                    ? `${existing} ${describedById}`
                    : describedById;
            }
            // Only when the caller has not already answered the question. A
            // control carrying the native `required` attribute is announced as
            // required without help, and a caller who set `aria-required` by
            // hand had a reason to.
            if (required && child.props['aria-required'] === undefined) {
                injected['aria-required'] = true;
            }
            // Give the control an id to be labelled by, but only one this field
            // generated itself.
            //
            // Never an id the caller supplied through `htmlFor`: that value
            // names an element the caller has already decided about, and the
            // child here may well not be it. Wrapping several controls in a
            // layout element and passing the inner one's id is the shape the
            // `htmlFor` docs invite, and stamping it onto the wrapper would put
            // the same id on two elements — the label would then resolve to the
            // wrapper, so clicking it focuses nothing and the real control
            // loses its accessible name. Never an id the child already carries
            // either, since something else may be referencing that one.
            const fieldOwnsId = htmlFor === undefined && child.props.id === undefined;

            if (hasLabel && fieldOwnsId) {
                injected.id = controlId;
            }

            if (Object.keys(injected).length > 0) {
                described = cloneElement(child, injected);
            }
        }

        return described;
    };

    return (
        <div className={cn(styles.field, className)}>
            {hasLabel && (
                <label className={styles.label} htmlFor={canAssociateLabel ? controlId : undefined}>
                    {label}
                    {/*
                      * Hidden from assistive technology rather than labelled.
                      * `aria-label` on a plain span is ignored — a span has the
                      * generic role, which does not support an accessible name
                      * — so the asterisk would have been announced as stray
                      * punctuation or skipped. The required state reaches a
                      * screen reader through `aria-required` on the control
                      * instead, which Field injects above.
                      */}
                    {required && (
                        <span className={styles.required} aria-hidden="true">
                            *
                        </span>
                    )}
                </label>
            )}
            {describedChildren()}
            {/*
              * The hint is deliberately kept out of the live region below. A
              * hint is frequently derived from the value as it is typed — the
              * migrated cron field restates the schedule in plain English on
              * every keystroke — and inside a live region that would queue the
              * whole sentence for announcement after each character, which is
              * the interruption "polite" was chosen to avoid.
              */}
            {showHint && (
                <div id={hintId} className={styles.message}>
                    {hint}
                </div>
            )}
            {/*
              * Rendered always, and always live, even with nothing to say. A
              * live region only announces content that changes *after* it is
              * already in the accessibility tree, so mounting the region and
              * its first message in the same commit — which is exactly what a
              * first validation failure does — drops the announcement that
              * matters most. Keeping the element in place costs an empty div,
              * and `.message:empty` drops its margin so the layout is unchanged
              * from when it was mounted conditionally.
              */}
            <div
                id={errorId}
                className={cn(styles.message, styles['message--error'])}
                aria-live="polite"
            >
                {errors.map((line, index) => (
                    // Indexed because `error` is caller-supplied and nothing
                    // dedupes it: a validator that checks one rule per token
                    // can legitimately report the same sentence twice, and the
                    // text alone would then collide as a key.
                    <span key={`${index}-${line}`} className={styles.message_line}>
                        <AlertCircle size={14} aria-hidden />
                        {line}
                    </span>
                ))}
            </div>
        </div>
    );
}
