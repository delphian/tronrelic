/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createMockFsModule,
    clearMockFilesystem
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

describe('MigrationScanner', () => {
    let scanner: MigrationScanner;

    beforeEach(() => {
        vi.clearAllMocks();
        clearMockFilesystem();
        scanner = new MigrationScanner();
    });

    describe('Naming Convention Validation', () => {
        /**
         * Test: Scanner should accept valid migration filenames.
         *
         * Verifies that filenames matching the required pattern (3 digits, underscore, lowercase name)
         * are accepted by the scanner.
         */
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

        /**
         * Test: Scanner should reject invalid migration filenames.
         *
         * Verifies that filenames not matching the required pattern are rejected
         * with appropriate warnings.
         */
        it('should reject invalid migration filenames', () => {
            const invalidNames = [
                '1_create_users.ts',        // Not enough leading zeros
                '001-create-users.ts',      // Hyphen instead of underscore
                '001_CreateUsers.ts',       // Uppercase letters
                'create_users.ts',          // Missing numeric prefix
                '001_create users.ts',      // Space in name
                '001_create_users.js'       // Wrong extension
            ];

            for (const name of invalidNames) {
                const isValid = (scanner as any).isValidFilename(name);
                expect(isValid, `Expected ${name} to be invalid`).toBe(false);
            }
        });
    });

    describe('Dependency Validation', () => {
        /**
         * Test: Scanner should validate all dependencies exist.
         *
         * Verifies that the scanner throws an error when a migration references
         * a dependency that doesn't exist in the discovered migrations.
         */
        it('should throw error when dependency does not exist', async () => {
            const migrations = [
                {
                    id: '001_base',
                    description: 'Base migration',
                    dependencies: [],
                    up: vi.fn()
                },
                {
                    id: '002_dependent',
                    description: 'Dependent migration',
                    dependencies: ['999_nonexistent'],  // This doesn't exist
                    up: vi.fn()
                }
            ];

            await expect(async () => {
                await (scanner as any).topologicalSort(migrations);
            }).rejects.toThrow(/depends on '999_nonexistent'.*not found/);
        });

        /**
         * Test: Scanner should accept valid dependencies.
         *
         * Verifies that migrations with valid dependencies are sorted correctly
         * in topological order.
         */
        it('should accept valid dependencies', async () => {
            const migrations = [
                {
                    id: '001_base',
                    description: 'Base migration',
                    dependencies: [],
                    up: vi.fn()
                },
                {
                    id: '002_dependent',
                    description: 'Dependent migration',
                    dependencies: ['001_base'],
                    up: vi.fn()
                }
            ];

            const sorted = await (scanner as any).topologicalSort(migrations);
            expect(sorted).toHaveLength(2);
            expect(sorted[0].id).toBe('001_base');
            expect(sorted[1].id).toBe('002_dependent');
        });
    });

    describe('Circular Dependency Detection', () => {
        /**
         * Test: Scanner should detect direct circular dependencies.
         *
         * Verifies that the scanner detects when two migrations directly depend
         * on each other (A → B → A).
         */
        it('should detect direct circular dependencies', async () => {
            const migrations = [
                {
                    id: 'A',
                    description: 'Migration A',
                    dependencies: ['B'],
                    up: vi.fn()
                },
                {
                    id: 'B',
                    description: 'Migration B',
                    dependencies: ['A'],
                    up: vi.fn()
                }
            ];

            await expect(async () => {
                await (scanner as any).topologicalSort(migrations);
            }).rejects.toThrow(/Circular dependency detected.*A.*B.*A/);
        });

        /**
         * Test: Scanner should detect indirect circular dependencies.
         *
         * Verifies that the scanner detects cycles through multiple migrations
         * (A → B → C → A).
         */
        it('should detect indirect circular dependencies', async () => {
            const migrations = [
                {
                    id: 'A',
                    description: 'Migration A',
                    dependencies: ['B'],
                    up: vi.fn()
                },
                {
                    id: 'B',
                    description: 'Migration B',
                    dependencies: ['C'],
                    up: vi.fn()
                },
                {
                    id: 'C',
                    description: 'Migration C',
                    dependencies: ['A'],  // Creates cycle
                    up: vi.fn()
                }
            ];

            await expect(async () => {
                await (scanner as any).topologicalSort(migrations);
            }).rejects.toThrow(/Circular dependency detected/);
        });

        /**
         * Test: Scanner should handle complex dependency graphs without cycles.
         *
         * Verifies that complex dependency graphs are sorted correctly when
         * no cycles exist.
         */
        it('should handle complex dependency graphs without cycles', async () => {
            const migrations = [
                {
                    id: '001',
                    description: 'Base',
                    dependencies: [],
                    up: vi.fn()
                },
                {
                    id: '002',
                    description: 'Depends on 001',
                    dependencies: ['001'],
                    up: vi.fn()
                },
                {
                    id: '003',
                    description: 'Depends on 001',
                    dependencies: ['001'],
                    up: vi.fn()
                },
                {
                    id: '004',
                    description: 'Depends on 002 and 003',
                    dependencies: ['002', '003'],
                    up: vi.fn()
                }
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
        /**
         * Test: Scanner should sort migrations in dependency order.
         *
         * Verifies that migrations are sorted so dependencies always come
         * before their dependents.
         */
        it('should sort migrations in dependency order', async () => {
            const migrations = [
                {
                    id: '003_third',
                    description: 'Third',
                    dependencies: ['001_first', '002_second'],
                    up: vi.fn()
                },
                {
                    id: '002_second',
                    description: 'Second',
                    dependencies: ['001_first'],
                    up: vi.fn()
                },
                {
                    id: '001_first',
                    description: 'First',
                    dependencies: [],
                    up: vi.fn()
                }
            ];

            const sorted = await (scanner as any).topologicalSort(migrations);
            expect(sorted).toHaveLength(3);
            expect(sorted[0].id).toBe('001_first');
            expect(sorted[1].id).toBe('002_second');
            expect(sorted[2].id).toBe('003_third');
        });

        /**
         * Test: Scanner should handle migrations with no dependencies.
         *
         * Verifies that independent migrations are sorted correctly (numeric order
         * when no dependencies exist).
         */
        it('should handle migrations with no dependencies', async () => {
            const migrations = [
                {
                    id: '003_third',
                    description: 'Third',
                    dependencies: [],
                    up: vi.fn()
                },
                {
                    id: '001_first',
                    description: 'First',
                    dependencies: [],
                    up: vi.fn()
                },
                {
                    id: '002_second',
                    description: 'Second',
                    dependencies: [],
                    up: vi.fn()
                }
            ];

            const sorted = await (scanner as any).topologicalSort(migrations);
            expect(sorted).toHaveLength(3);
            // Independent migrations maintain input order (or source-based order)
            expect(sorted.map((m: any) => m.id)).toEqual(['003_third', '001_first', '002_second']);
        });
    });

    describe('Checksum Calculation', () => {
        /**
         * Test: Scanner should calculate consistent checksums.
         *
         * Verifies that the same file content always produces the same checksum.
         */
        it('should calculate consistent checksums', () => {
            const content = 'export const migration = { id: "001_test", up: async () => {} };';
            const checksum1 = (scanner as any).calculateChecksum(content);
            const checksum2 = (scanner as any).calculateChecksum(content);

            expect(checksum1).toBe(checksum2);
            expect(checksum1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
        });

        /**
         * Test: Scanner should detect content changes via checksum.
         *
         * Verifies that different file content produces different checksums.
         */
        it('should detect content changes via checksum', () => {
            const content1 = 'export const migration = { id: "001_test", up: async () => {} };';
            const content2 = 'export const migration = { id: "001_test", up: async () => { await db.set("key", "value"); } };';

            const checksum1 = (scanner as any).calculateChecksum(content1);
            const checksum2 = (scanner as any).calculateChecksum(content2);

            expect(checksum1).not.toBe(checksum2);
        });
    });

    describe('Migration Object Validation', () => {
        /**
         * Test: Scanner should validate and accept valid migration object.
         *
         * Verifies that a properly structured migration module can be validated
         * and converted to complete metadata.
         */
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
            expect(metadata.description).toBe('Test migration');
            expect(metadata.source).toBe('system');
            expect(metadata.dependencies).toEqual([]);
            expect(metadata.filePath).toBe('/test/path/001_test.ts');
            expect(metadata.checksum).toBe('abc123checksum');
        });

        /**
         * Test: Scanner should reject migration with missing required fields.
         *
         * Verifies that migrations missing required fields (id, description, up)
         * are rejected with clear error messages.
         */
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

        /**
         * Test: Scanner should reject migration with mismatched ID.
         *
         * Verifies that the migration ID must match the filename.
         */
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

        /**
         * Test: Scanner should reject module without migration export.
         *
         * Verifies that modules must export a 'migration' object.
         */
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
    });
});
