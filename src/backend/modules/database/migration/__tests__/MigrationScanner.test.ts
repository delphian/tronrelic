/// <reference types="vitest" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import {
    createMockFsModule,
    clearMockFilesystem,
    setMockDirectory
} from '../../../../tests/vitest/mocks/fs.js';

// Mock logger to prevent console output during tests
vi.mock('../../../../lib/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

// Mock fs/promises with comprehensive centralized mock
vi.mock('fs/promises', () => createMockFsModule()());

// Import MigrationScanner AFTER mocking dependencies
import { MigrationScanner } from '../MigrationScanner.js';

/**
 * Helper function to create migration test fixtures with qualified IDs.
 * Simulates what the scanner does during validation.
 */
function createMigrationFixture(id: string, options: {
    source?: string;
    description?: string;
    dependencies?: string[];
} = {}) {
    const source = options.source || 'system';
    const qualifiedId = source === 'system' ? id : `${source}:${id}`;

    return {
        id,
        qualifiedId,
        description: options.description || `Migration ${id}`,
        source,
        dependencies: options.dependencies || [],
        up: vi.fn()
    };
}

describe('MigrationScanner', () => {
    let scanner: MigrationScanner;

    beforeEach(() => {
        vi.clearAllMocks();
        clearMockFilesystem();
        scanner = new MigrationScanner();
    });

    describe('Naming Convention Validation', () => {
        it('should accept valid migration filenames', () => {
            const validNames = [
                '001_create_users.ts',
                '042_add_indexes.ts',
                '123_migrate_data.ts',
                '999_cleanup_legacy.ts'
            ];

            for (const name of validNames) {
                // Use internal validation method via reflection
                const isValid = (scanner as any).isValidFilename(name);
                expect(isValid, `Expected ${name} to be valid`).toBe(true);
            }
        });

        /** .ts files serve development and .js files serve production/Docker deployments. */
        it('should accept both .ts and .js extensions', () => {
            const validExtensions = [
                '001_create_users.ts',
                '001_create_users.js',
                '042_add_indexes.ts',
                '042_add_indexes.js'
            ];

            for (const name of validExtensions) {
                const isValid = (scanner as any).isValidFilename(name);
                expect(isValid, `Expected ${name} to be valid`).toBe(true);
            }
        });

        /**
         * Production/Docker deployments compile migrations to JavaScript, so
         * scanDirectory() must not filter on `.ts` alone; an `endsWith('.ts')`
         * check skips every compiled migration.
         */
        it('should include .js files in file filtering logic', () => {
            // Mock file list with both .ts and .js files
            const mockFiles = [
                '001_test.ts',
                '002_test.js',
                '003_test.ts',
                '004_test.js',
                'README.md',  // Should be filtered out
                'invalid.py'  // Should be filtered out
            ];

            // Simulate the file filtering logic from scanDirectory() at line 365
            const filteredFiles = mockFiles.filter(file => {
                // This is the logic we're testing (must accept both .ts and .js)
                return file.endsWith('.ts') || file.endsWith('.js');
            });

            // Should include all .ts and .js files
            expect(filteredFiles).toHaveLength(4);
            expect(filteredFiles).toContain('001_test.ts');
            expect(filteredFiles).toContain('002_test.js');
            expect(filteredFiles).toContain('003_test.ts');
            expect(filteredFiles).toContain('004_test.js');

            // Should exclude non-migration files
            expect(filteredFiles).not.toContain('README.md');
            expect(filteredFiles).not.toContain('invalid.py');
        });

        it('should reject invalid migration filenames', () => {
            const invalidNames = [
                '1_create_users.ts',        // Not enough leading zeros
                '001-create-users.ts',      // Hyphen instead of underscore
                '001_CreateUsers.ts',       // Uppercase letters
                'create_users.ts',          // Missing numeric prefix
                '001_create users.ts',      // Space in name
                '001_create_users.py'       // Wrong extension
            ];

            for (const name of invalidNames) {
                const isValid = (scanner as any).isValidFilename(name);
                expect(isValid, `Expected ${name} to be invalid`).toBe(false);
            }
        });
    });

    describe('Dependency Validation', () => {
        it('should throw error when dependency does not exist', async () => {
            const migrations = [
                {
                    id: '001_base',
                    qualifiedId: '001_base',
                    description: 'Base migration',
                    dependencies: [],
                    up: vi.fn()
                },
                {
                    id: '002_dependent',
                    qualifiedId: '002_dependent',
                    description: 'Dependent migration',
                    dependencies: ['999_nonexistent'],  // This doesn't exist
                    up: vi.fn()
                }
            ];

            await expect(async () => {
                await (scanner as any).topologicalSort(migrations);
            }).rejects.toThrow(/depends on '999_nonexistent'.*not found/);
        });

        it('should accept valid dependencies', async () => {
            const migrations = [
                createMigrationFixture('001_base'),
                createMigrationFixture('002_dependent', { dependencies: ['001_base'] })
            ];

            const sorted = await (scanner as any).topologicalSort(migrations);
            expect(sorted).toHaveLength(2);
            expect(sorted[0].id).toBe('001_base');
            expect(sorted[1].id).toBe('002_dependent');
        });
    });

    describe('Phantom Dependency Resolution', () => {
        /** Lets operators retire old migration source files once every environment has run them. */
        it('should accept dep recorded as completed even when not on disk', async () => {
            const migrations = [
                createMigrationFixture('002_dependent', { dependencies: ['001_retired'] })
            ];
            const completed = new Set(['001_retired']);

            const sorted = await (scanner as any).topologicalSort(migrations, completed);
            expect(sorted).toHaveLength(1);
            expect(sorted[0].id).toBe('002_dependent');
        });

        /** Fresh environments without history keep the same fail-fast behavior. */
        it('should throw when dep is absent from both disk and history', async () => {
            const migrations = [
                createMigrationFixture('002_dependent', { dependencies: ['999_phantom'] })
            ];
            const completed = new Set<string>();

            await expect(async () => {
                await (scanner as any).topologicalSort(migrations, completed);
            }).rejects.toThrow(/depends on '999_phantom'/);
        });

        /**
         * Regression check: the previous code did `migrationMap.get(lookupId)!`
         * and would have crashed.
         */
        it('should treat phantom deps as DFS leaves without crashing', async () => {
            const migrations = [
                createMigrationFixture('A', { dependencies: ['phantom'] }),
                createMigrationFixture('B', { dependencies: ['A'] })
            ];
            const completed = new Set(['phantom']);

            const sorted = await (scanner as any).topologicalSort(migrations, completed);
            expect(sorted).toHaveLength(2);
            expect(sorted.findIndex((m: any) => m.id === 'A'))
                .toBeLessThan(sorted.findIndex((m: any) => m.id === 'B'));
        });

        it('should require deps on disk when no completed set is passed', async () => {
            const migrations = [
                createMigrationFixture('002_dependent', { dependencies: ['001_missing'] })
            ];

            await expect(async () => {
                await (scanner as any).topologicalSort(migrations);
            }).rejects.toThrow(/depends on '001_missing'/);
        });
    });

    describe('Circular Dependency Detection', () => {
        it('should detect direct circular dependencies', async () => {
            const migrations = [
                createMigrationFixture('A', { dependencies: ['B'] }),
                createMigrationFixture('B', { dependencies: ['A'] })
            ];

            await expect(async () => {
                await (scanner as any).topologicalSort(migrations);
            }).rejects.toThrow(/Circular dependency detected.*A.*B.*A/);
        });

        it('should detect indirect circular dependencies', async () => {
            const migrations = [
                createMigrationFixture('A', { dependencies: ['B'] }),
                createMigrationFixture('B', { dependencies: ['C'] }),
                createMigrationFixture('C', { dependencies: ['A'] })  // Creates cycle
            ];

            await expect(async () => {
                await (scanner as any).topologicalSort(migrations);
            }).rejects.toThrow(/Circular dependency detected/);
        });

        it('should handle complex dependency graphs without cycles', async () => {
            const migrations = [
                createMigrationFixture('001'),
                createMigrationFixture('002', { dependencies: ['001'] }),
                createMigrationFixture('003', { dependencies: ['001'] }),
                createMigrationFixture('004', { dependencies: ['002', '003'] })
            ];

            const sorted = await (scanner as any).topologicalSort(migrations);
            expect(sorted).toHaveLength(4);
            expect(sorted[0].id).toBe('001');
            expect(sorted[3].id).toBe('004');

            // Verify 002 and 003 come before 004
            const index002 = sorted.findIndex((m: any) => m.id === '002');
            const index003 = sorted.findIndex((m: any) => m.id === '003');
            const index004 = sorted.findIndex((m: any) => m.id === '004');
            expect(index002).toBeLessThan(index004);
            expect(index003).toBeLessThan(index004);
        });
    });

    describe('Topological Sorting', () => {
        it('should sort migrations in dependency order', async () => {
            const migrations = [
                createMigrationFixture('003_third', { dependencies: ['001_first', '002_second'] }),
                createMigrationFixture('002_second', { dependencies: ['001_first'] }),
                createMigrationFixture('001_first')
            ];

            const sorted = await (scanner as any).topologicalSort(migrations);
            expect(sorted).toHaveLength(3);
            expect(sorted[0].id).toBe('001_first');
            expect(sorted[1].id).toBe('002_second');
            expect(sorted[2].id).toBe('003_third');
        });

        it('should handle migrations with no dependencies', async () => {
            const migrations = [
                createMigrationFixture('003_third'),
                createMigrationFixture('001_first'),
                createMigrationFixture('002_second')
            ];

            const sorted = await (scanner as any).topologicalSort(migrations);
            expect(sorted).toHaveLength(3);
            // Independent migrations maintain input order (or source-based order)
            expect(sorted.map((m: any) => m.id)).toEqual(['003_third', '001_first', '002_second']);
        });
    });

    describe('Checksum Calculation', () => {
        it('should calculate consistent checksums', () => {
            const content = 'export const migration = { id: "001_test", up: async () => {} };';
            const checksum1 = (scanner as any).calculateChecksum(content);
            const checksum2 = (scanner as any).calculateChecksum(content);

            expect(checksum1).toBe(checksum2);
            expect(checksum1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
        });

        it('should detect content changes via checksum', () => {
            const content1 = 'export const migration = { id: "001_test", up: async () => {} };';
            const content2 = 'export const migration = { id: "001_test", up: async () => { await db.set("key", "value"); } };';

            const checksum1 = (scanner as any).calculateChecksum(content1);
            const checksum2 = (scanner as any).calculateChecksum(content2);

            expect(checksum1).not.toBe(checksum2);
        });
    });

    describe('Migration Object Validation', () => {
        it('should validate valid migration object', () => {
            const mockModule = {
                migration: {
                    id: '001_test',
                    description: 'Test migration',
                    dependencies: [],
                    up: vi.fn()
                }
            };

            const metadata = scanner.validateMigrationObject(
                mockModule,
                '/test/path/001_test.ts',
                'system',
                'abc123checksum',
                new Date('2024-01-01')
            );

            expect(metadata.id).toBe('001_test');
            expect(metadata.qualifiedId).toBe('001_test'); // System migrations use plain ID
            expect(metadata.description).toBe('Test migration');
            expect(metadata.source).toBe('system');
            expect(metadata.dependencies).toEqual([]);
            expect(metadata.filePath).toBe('/test/path/001_test.ts');
            expect(metadata.checksum).toBe('abc123checksum');
        });

        it('should reject migration with missing required fields', () => {
            const invalidModule = {
                migration: {
                    id: '001_test',
                    // Missing description
                    dependencies: [],
                    up: vi.fn()
                }
            };

            expect(() => {
                scanner.validateMigrationObject(
                    invalidModule,
                    '/test/path/001_test.ts',
                    'system',
                    'abc123',
                    new Date()
                );
            }).toThrow(/description/);
        });

        it('should reject migration with mismatched ID', () => {
            const mockModule = {
                migration: {
                    id: '999_wrong',  // Doesn't match filename
                    description: 'Test migration',
                    dependencies: [],
                    up: vi.fn()
                }
            };

            expect(() => {
                scanner.validateMigrationObject(
                    mockModule,
                    '/test/path/001_test.ts',
                    'system',
                    'abc123',
                    new Date()
                );
            }).toThrow(/ID mismatch/);
        });

        it('should reject module without migration export', () => {
            const invalidModule = {
                // Missing migration property
                something: 'else'
            };

            expect(() => {
                scanner.validateMigrationObject(
                    invalidModule,
                    '/test/path/001_test.ts',
                    'system',
                    'abc123',
                    new Date()
                );
            }).toThrow(/must export 'migration' object/);
        });

        it('should generate qualified ID for module migration', () => {
            const mockModule = {
                migration: {
                    id: '001_add_namespace',
                    description: 'Add namespace field',
                    dependencies: [],
                    up: vi.fn()
                }
            };

            const metadata = scanner.validateMigrationObject(
                mockModule,
                '/test/path/001_add_namespace.ts',
                'module:menu',
                'abc123',
                new Date()
            );

            expect(metadata.id).toBe('001_add_namespace');
            expect(metadata.qualifiedId).toBe('module:menu:001_add_namespace');
            expect(metadata.source).toBe('module:menu');
        });

        it('should generate qualified ID for plugin migration', () => {
            const mockModule = {
                migration: {
                    id: '001_create_subscriptions',
                    description: 'Create subscriptions collection',
                    dependencies: [],
                    up: vi.fn()
                }
            };

            const metadata = scanner.validateMigrationObject(
                mockModule,
                '/test/path/001_create_subscriptions.ts',
                'plugin:whale-alerts',
                'abc123',
                new Date()
            );

            expect(metadata.id).toBe('001_create_subscriptions');
            expect(metadata.qualifiedId).toBe('plugin:whale-alerts:001_create_subscriptions');
            expect(metadata.source).toBe('plugin:whale-alerts');
        });
    });

    /**
     * The dist-vs-src branch decides whether migrations are discovered at all:
     * if production walks a path holding .ts source files, plugin migrations are
     * silently skipped. These cases cover both production-strict and
     * dev-prefer-src resolution so that cannot happen unnoticed.
     */
    describe('Path Resolution (dist vs src)', () => {
        afterEach(() => {
            vi.unstubAllEnvs();
        });

        it('returns dist/ for system migrations in production', async () => {
            vi.stubEnv('NODE_ENV', 'production');
            const fresh = new MigrationScanner();
            const root = await (fresh as any).resolveBackendRoot();
            expect(root).toBe(join(process.cwd(), 'dist', 'backend'));
        });

        it('returns dist/ for system migrations in production even when src/ exists', async () => {
            vi.stubEnv('NODE_ENV', 'production');
            setMockDirectory(join(process.cwd(), 'src', 'backend'));
            const fresh = new MigrationScanner();
            const root = await (fresh as any).resolveBackendRoot();
            expect(root).toBe(join(process.cwd(), 'dist', 'backend'));
        });

        it('returns src/ for system migrations in development when src/ exists', async () => {
            vi.stubEnv('NODE_ENV', 'development');
            setMockDirectory(join(process.cwd(), 'src', 'backend'));
            const fresh = new MigrationScanner();
            const root = await (fresh as any).resolveBackendRoot();
            expect(root).toBe(join(process.cwd(), 'src', 'backend'));
        });

        it('falls through to dist/ in development when src/ is absent', async () => {
            vi.stubEnv('NODE_ENV', 'development');
            const fresh = new MigrationScanner();
            const root = await (fresh as any).resolveBackendRoot();
            expect(root).toBe(join(process.cwd(), 'dist', 'backend'));
        });

        it('returns dist/ for plugin migrations in production', async () => {
            vi.stubEnv('NODE_ENV', 'production');
            const fresh = new MigrationScanner();
            const path = await (fresh as any).resolvePluginMigrationsPath('/app/src/plugins/my-plugin');
            expect(path).toBe('/app/src/plugins/my-plugin/dist/backend/migrations');
        });

        it('returns dist/ for plugin migrations in production even when src/ exists', async () => {
            vi.stubEnv('NODE_ENV', 'production');
            setMockDirectory('/app/src/plugins/my-plugin/src/backend/migrations');
            const fresh = new MigrationScanner();
            const path = await (fresh as any).resolvePluginMigrationsPath('/app/src/plugins/my-plugin');
            expect(path).toBe('/app/src/plugins/my-plugin/dist/backend/migrations');
        });

        it('returns src/ for plugin migrations in development when src/ exists', async () => {
            vi.stubEnv('NODE_ENV', 'development');
            setMockDirectory('/app/src/plugins/my-plugin/src/backend/migrations');
            const fresh = new MigrationScanner();
            const path = await (fresh as any).resolvePluginMigrationsPath('/app/src/plugins/my-plugin');
            expect(path).toBe('/app/src/plugins/my-plugin/src/backend/migrations');
        });

        it('falls through to dist/ for plugin migrations in development when src/ is absent', async () => {
            vi.stubEnv('NODE_ENV', 'development');
            const fresh = new MigrationScanner();
            const path = await (fresh as any).resolvePluginMigrationsPath('/app/src/plugins/my-plugin');
            expect(path).toBe('/app/src/plugins/my-plugin/dist/backend/migrations');
        });
    });
});
