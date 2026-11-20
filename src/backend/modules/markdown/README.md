# Markdown Module

The markdown module owns the one pipeline that turns authored markdown into HTML for visitors, and publishes it so every module and plugin renders markdown the same way. CMS pages and blog posts both inject the result with `dangerouslySetInnerHTML`, which is safe only because the HTML was sanitized first. Keeping that sanitize step in one place means a fix to it reaches every surface at once, instead of only the copy someone remembered to update.

## Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `markdown` |
| Service registry name | `'markdown'` (`MARKDOWN_SERVICE_NAME`), published in `run()` |
| Contract | `IMarkdownRendererService` and `IMarkdownRenderOptions` in `@/types` (`packages/types/src/markdown/`) |
| Implementation | `MarkdownRendererService`, a singleton (`services/markdown-renderer.service.ts`) |
| Consumers | The pages module (handed the renderer directly at init), and the `trp-blog` plugin (resolves `'markdown'` from the registry) |
| Storage, routes, jobs | None |
| Admin page | None. The module has no settings, storage, or jobs to show, and its log entries appear on `/system/logs` under `tronrelic:markdown` |
| Logs | `tronrelic:markdown` — a render failure is logged here before it is thrown to the caller |

## Source Map

| File | Purpose |
|------|---------|
| `MarkdownModule.ts` | `IModule` implementation. `init()` configures the renderer singleton; `run()` publishes it as `'markdown'`; `getRenderer()` hands it to bootstrap for the pages module |
| `services/markdown-renderer.service.ts` | The pipeline: remark with GitHub Flavored Markdown, then rehype-sanitize over the whole HTML, then any requested adjustments |
| `lib/rehypeDemoteHeadings.ts` | Rehype plugin behind the `demoteHeadings` option |
| `index.ts` | Public exports |

## Contract

`render(markdown, options?)` returns sanitized HTML. The markdown is parsed with GitHub Flavored Markdown, so tables, strikethrough, task lists, and autolinks work. The conversion keeps raw HTML written in the markdown, and rehype-sanitize then cleans the complete result with its default schema, so scripts, event handler attributes, and `javascript:` links are removed whether they came from markdown syntax or raw HTML. A failure is logged under `tronrelic:markdown` and rethrown, because only the caller knows whether a failed render should refuse a save or fail a request.

| Option | Default | Effect |
|--------|---------|--------|
| `demoteHeadings` | `false` | Shifts every heading down one level (h1 to h2, through h5 to h6; h6 stays h6). Set it when the page already renders its own title as the only `<h1>`, as the blog post page does, so a body that opens with `# Heading` does not add a second one |

Adjustments run after sanitizing, so an option can only rename or rearrange markup the sanitizer already allowed. A new adjustment belongs here as another option, not in a caller's own copy of the pipeline.

## Lifecycle and Wiring

The module inits immediately before the pages module in `bootstrapInit()` and runs immediately before it in `bootstrapRun()`. Pages receives the renderer through its `markdownRenderer` dependency, because the registry entry does not exist until this module's `run()`. Plugins load after every module has run, so `context.services.get('markdown')` always finds it, and since a module cannot be disabled the entry never goes away at runtime.

A plugin depends on the contract through `@delphian/tronrelic-types` with `import type` only, and spells the registry name as the string `'markdown'`. It cannot import `MARKDOWN_SERVICE_NAME`, because that would be a runtime import of core code.

## Testing

`__tests__/` covers the module lifecycle and the pipeline, including the sanitize cases. Tests in other modules that render markdown take the real renderer from `createTestMarkdownRenderer()` in `src/backend/tests/vitest/mocks/markdown-renderer.ts`, so their assertions about HTML check the production rules.

## Related

- [Pages Module README](../pages/README.md) — renders page bodies and translations through this module
- [Backend Modules Overview](../../../../docs/system/modules/modules.md)
- [Service registry for plugins](../../../../docs/plugins/plugins-service-registry.md)
