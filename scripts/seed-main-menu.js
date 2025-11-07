#!/usr/bin/env node
/**
 * Seed main namespace menu items.
 *
 * Creates the core navigation items for the 'main' namespace:
 * - Overview (/)
 * - Accounts (/accounts)
 *
 * Note: Energy Markets menu item is now registered by the resource-markets plugin.
 *
 * This script connects directly to MongoDB and inserts menu items if they don't exist.
 * Safe to run multiple times - checks for existing items before inserting.
 *
 * Usage:
 *   node scripts/seed-main-menu.js
 */

const { MongoClient } = require('mongodb');

// MongoDB connection (uses same URI as backend)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tronrelic';
const NAMESPACE = 'main';

// Menu items to seed
const MENU_ITEMS = [
    {
        namespace: NAMESPACE,
        label: 'Overview',
        url: '/',
        icon: null,
        order: 0,
        parent: null,
        enabled: true,
        children: [],
        createdAt: new Date(),
        updatedAt: new Date()
    },
    {
        namespace: NAMESPACE,
        label: 'Accounts',
        url: '/accounts',
        icon: null,
        order: 6,
        parent: null,
        enabled: true,
        children: [],
        createdAt: new Date(),
        updatedAt: new Date()
    }
];

async function seedMainMenu() {
    const client = new MongoClient(MONGODB_URI);

    try {
        console.log('Connecting to MongoDB...');
        await client.connect();
        console.log('✓ Connected');

        const db = client.db();
        const collection = db.collection('menu_nodes');

        for (const item of MENU_ITEMS) {
            // Check if item already exists
            const existing = await collection.findOne({
                namespace: item.namespace,
                url: item.url
            });

            if (existing) {
                console.log(`⊘ Skip: "${item.label}" already exists`);
                continue;
            }

            // Insert new item
            const result = await collection.insertOne(item);
            console.log(`✓ Created: "${item.label}" (${result.insertedId})`);
        }

        console.log('\n✓ Main namespace menu seeding complete');
    } catch (error) {
        console.error('✗ Error seeding menu items:', error);
        process.exit(1);
    } finally {
        await client.close();
    }
}

// Run seeder
seedMainMenu();
