# Pages Module Test Suite

Comprehensive test coverage for the TronRelic custom pages system.

## Test Files

### 1. page.service.test.ts (42 tests)
Tests the core `PageService` business logic.

**Page Management (16 tests):**
- Creating pages with frontmatter
- Slug generation and sanitization
- Slug validation and blacklist checking
- Updating pages with frontmatter changes
- Retrieving pages by ID or slug
- Listing pages with filters (published status, search, pagination)
- Deleting pages
- Page statistics (total, published, drafts)

**Markdown Rendering (3 tests):**
- Rendering markdown to HTML
- HTML caching in Redis
- Using cached HTML on subsequent requests

**File Management (8 tests):**
- Uploading files with validation
- File size limits
- Allowed file extension validation
- Filename sanitization
- Listing files with MIME type filtering
- Deleting files

**Settings Management (4 tests):**
- Getting default settings
- Getting existing settings from database
- Updating settings
- Settings validation

**Slug Utilities (11 tests):**
- Slug sanitization (spaces, special characters, hyphens)
- Forward slash prefixing
- Blacklist pattern matching

### 2. markdown.service.test.ts (21 tests)
Tests the `MarkdownService` for parsing and rendering.

**Frontmatter Parsing (7 tests):**
- Parsing YAML frontmatter
- Handling missing optional fields
- Handling content without frontmatter
- Boolean field parsing (published)
- Array field parsing (keywords)
- Invalid YAML error handling

**Markdown Rendering (8 tests):**
- Basic markdown (headings, bold, italic)
- Lists (ordered and unordered)
- Links
- Code blocks
- GitHub Flavored Markdown (tables, strikethrough)
- HTML sanitization (XSS prevention)
- Empty markdown handling

**Caching (3 tests):**
- Getting cached HTML
- Cache misses
- Cache invalidation

**Integration (3 tests):**
- Combined parsing and rendering workflow
- Frontmatter extraction with body rendering
- Complex markdown with multiple elements

### 3. storage.test.ts (16 tests)
Tests the `LocalStorageProvider` for file operations.

**Upload Tests (6 tests):**
- Uploading files to date-based directories
- Directory structure creation
- Binary file handling
- Filenames with special characters
- Directory creation errors
- File write errors

**Delete Tests (3 tests):**
- Deleting existing files
- Error handling for non-existent files
- Path format handling

**Get URL Tests (2 tests):**
- Returning correct paths for local storage
- Path preservation

**Integration Tests (2 tests):**
- Upload and delete workflow
- Concurrent uploads

**Edge Cases (3 tests):**
- Empty files
- Large files (1MB)
- Same filename in different months

### 4. pages.controller.test.ts (29 tests)
Tests the `PagesController` HTTP endpoints.

**Page Endpoints (9 tests):**
- Listing pages with stats
- Query parameter handling
- Getting page by ID
- 404 handling for missing pages
- Creating new pages
- Content validation
- Updating pages
- Deleting pages

**File Endpoints (5 tests):**
- Listing uploaded files
- MIME type filtering
- Uploading files
- Missing file validation
- Deleting files

**Settings Endpoints (3 tests):**
- Getting current settings
- Updating settings
- Settings validation errors

**Public Endpoints (12 tests):**
- Getting published pages by slug
- Slug normalization (prepending slash)
- 404 for non-existent pages
- 404 for unpublished pages
- Rendering published page HTML
- Metadata extraction
- Access control (only published pages visible)

### 5. pages.module.test.ts (13 tests)
Tests the module initialization and dependency injection.

**Router Creation (2 tests):**
- Admin router creation
- Public router creation

**Module Initialization (4 tests):**
- Full module initialization
- Router generation
- Menu item registration via MenuService
- Error handling during menu registration

**Integration Tests (3 tests):**
- Complete module with all routers and menu
- Multiple initializations (hot reload simulation)

**Dependency Injection (4 tests):**
- Database service injection
- Cache service injection
- Menu service injection
- Storage provider injection

## Coverage Summary

**Total Tests:** 121

**Test Distribution:**
- PageService: 42 tests (35%)
- MarkdownService: 21 tests (17%)
- LocalStorageProvider: 16 tests (13%)
- PagesController: 29 tests (24%)
- Module Initialization: 13 tests (11%)

## Key Features Tested

### Functional Coverage
- ✅ Page CRUD operations (create, read, update, delete)
- ✅ Frontmatter parsing and validation
- ✅ Markdown to HTML rendering with GFM support
- ✅ HTML sanitization for security (XSS prevention)
- ✅ Redis caching for rendered HTML
- ✅ File upload with size and extension validation
- ✅ Filename sanitization
- ✅ Local filesystem storage with date-based organization
- ✅ Slug generation and sanitization
- ✅ Slug blacklist pattern matching
- ✅ Settings management with validation
- ✅ HTTP endpoint request/response handling
- ✅ Express middleware integration
- ✅ Module initialization with dependency injection
- ✅ Menu service integration

### Error Handling
- ✅ Missing required fields (title in frontmatter)
- ✅ Duplicate slugs
- ✅ Blacklisted slugs
- ✅ File size limits
- ✅ Disallowed file extensions
- ✅ Invalid frontmatter YAML
- ✅ Missing pages/files (404 errors)
- ✅ File system errors (permissions, disk full)
- ✅ Menu registration failures

### Security
- ✅ HTML sanitization (script tag removal)
- ✅ Filename sanitization (special characters)
- ✅ Blacklisted route patterns
- ✅ File extension validation
- ✅ Published status enforcement (unpublished pages return 404)

### Performance
- ✅ Redis caching for rendered HTML
- ✅ Cache invalidation on updates
- ✅ Date-based file organization for filesystem efficiency
- ✅ Pagination support for list operations

## Running the Tests

```bash
# Run all pages module tests
npm test -- apps/backend/src/modules/pages/__tests__/

# Run specific test file
npm test -- apps/backend/src/modules/pages/__tests__/page.service.test.ts

# Run tests in watch mode
npm test -- apps/backend/src/modules/pages/__tests__/ --watch
```

## Mock Implementations

The test suite includes comprehensive mock implementations:

- **MockCacheService** - In-memory Redis simulation with TTL support
- **MockStorageProvider** - In-memory file storage
- **MockDatabaseService** - In-memory MongoDB simulation with full query support
  - Supports filters (ObjectId, regex, text search)
  - Supports sorting (ascending/descending)
  - Supports pagination (skip, limit)
  - Chainable query builder
- **MockMenuService** - Menu service with event subscription
- **MockPageService** - Controller-level service mock with Vitest spies
- **Mock Logger** - Logging with Vitest spies

## Patterns Used

- **AAA Pattern** (Arrange, Act, Assert)
- **beforeEach/afterEach** for test isolation
- **Mock clearing** between tests
- **Descriptive test names** following "should [behavior] when [condition]" pattern
- **Comprehensive assertions** (status codes, response payloads, side effects)
- **Error scenario testing** (validation errors, not found errors, system errors)
- **Integration testing** (multiple operations combined)
- **Edge case testing** (empty files, large files, concurrent operations)

## Future Enhancements

Potential areas for additional test coverage:

- [ ] Concurrent page updates (optimistic locking)
- [ ] S3 storage provider implementation and tests
- [ ] Text search indexing and full-text search
- [ ] Page versioning and history
- [ ] Bulk operations (batch delete, batch update)
- [ ] Webhook notifications on page publish/unpublish
- [ ] Page templates and categories
- [ ] Custom field support in frontmatter
- [ ] Image optimization and resizing
- [ ] Draft autosave functionality
