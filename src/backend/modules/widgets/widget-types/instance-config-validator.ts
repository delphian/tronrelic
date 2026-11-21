/**
 * @fileoverview Checks a widget's settings against its type's JSON Schema.
 *
 * Two paths hand a widget fetcher settings that came from outside the code:
 * a placement saved on `/system/widgets`, and a widget embedded in a page or
 * post body. Both must apply the same schema rules, including the custom
 * formats the placement form offers as pickers, or an embed could pass
 * settings the placement API refuses. This class is the one check both use.
 *
 * - `allErrors` reports every bad field at once.
 * - `strict: false` lets a plugin schema carry keywords AJV does not know,
 *   such as UI hints, without failing to compile.
 * - Compiled validators are cached on the schema object. Descriptors are
 *   frozen and re-minted on each plugin re-enable, so a changed schema is a
 *   new object and needs no explicit invalidation.
 */

import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { JSONSchema7 } from 'json-schema';
import type { ISystemLogService } from '@/types';
import { WIDGET_ICON_FORMAT, WIDGET_IMAGE_FORMAT, WIDGET_MENU_NAMESPACE_FORMAT } from '@/types';

/**
 * One field that failed the schema. `path` is the JSON Pointer to the field,
 * empty for the whole object; `message` is the reason.
 */
export interface IInstanceConfigFieldError {
    readonly path: string;
    readonly message: string;
}

/**
 * Validates widget settings against widget-type schemas.
 *
 * A utility rather than a service: the widgets module constructs one and
 * hands it to the placement controller and the embed resolver.
 */
export class InstanceConfigValidator {
    private readonly ajv: Ajv;
    private readonly validatorCache = new WeakMap<JSONSchema7, ValidateFunction>();

    /**
     * @param logger - Records a schema that fails to compile, which is a bug
     *   in the widget type rather than in the settings being checked.
     */
    constructor(private readonly logger: ISystemLogService) {
        this.ajv = new Ajv({ allErrors: true, strict: false });
        addFormats(this.ajv);
        // Registered rather than left unknown: AJV warns on every compile of
        // a schema naming an unknown format and then validates nothing, so a
        // setting the form offers as an icon picker, image picker, or menu
        // namespace dropdown would accept any string.
        this.ajv.addFormat(WIDGET_ICON_FORMAT.name, new RegExp(WIDGET_ICON_FORMAT.pattern));
        this.ajv.addFormat(WIDGET_IMAGE_FORMAT.name, WIDGET_IMAGE_FORMAT.isValid);
        this.ajv.addFormat(WIDGET_MENU_NAMESPACE_FORMAT.name, new RegExp(WIDGET_MENU_NAMESPACE_FORMAT.pattern));
    }

    /**
     * Check settings against a schema.
     *
     * A schema that fails to compile is logged and reported as one
     * whole-object error, so a widget author's mistake reaches the caller
     * as refused settings rather than as a crash.
     *
     * @param typeId - The widget type, named in the log when its schema is broken.
     * @param schema - The type's declared schema; absent means any object passes.
     * @param config - The settings to check.
     * @returns The failing fields, or null when the settings pass.
     */
    validate(
        typeId: string,
        schema: JSONSchema7 | undefined,
        config: Record<string, unknown>
    ): ReadonlyArray<IInstanceConfigFieldError> | null {
        let result: ReadonlyArray<IInstanceConfigFieldError> | null = null;
        if (schema) {
            const validator = this.compile(typeId, schema);
            if (!validator) {
                result = [{ path: '', message: 'Widget type schema compilation failed' }];
            } else if (!validator(config)) {
                result = (validator.errors ?? []).map(err => ({
                    path: err.instancePath,
                    message: err.message ?? 'invalid value'
                }));
            }
        }
        return result;
    }

    /**
     * Return the cached validator for a schema, compiling it on first use, or
     * null when the schema cannot be compiled.
     */
    private compile(typeId: string, schema: JSONSchema7): ValidateFunction | null {
        let validator = this.validatorCache.get(schema) ?? null;
        if (!validator) {
            try {
                validator = this.ajv.compile(schema);
                this.validatorCache.set(schema, validator);
            } catch (error) {
                this.logger.error({ err: error, typeId }, 'Failed to compile widget configSchema');
                validator = null;
            }
        }
        return validator;
    }
}
