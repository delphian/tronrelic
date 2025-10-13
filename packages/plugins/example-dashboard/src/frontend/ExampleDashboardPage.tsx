'use client';

/**
 * Example Dashboard Page Component.
 *
 * This component demonstrates how a plugin can provide a full page with custom UI.
 * It's rendered when users navigate to /example-dashboard via the plugin page registration system.
 */
export function ExampleDashboardPage() {
    return (
        <div className="container mx-auto px-4 py-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-4xl font-bold mb-4">Example Dashboard</h1>
                <p className="text-lg text-muted-foreground mb-8">
                    This is a demonstration page provided by the Example Dashboard plugin.
                    It shows how plugins can register their own pages and menu items.
                </p>

                <div className="grid gap-6 md:grid-cols-2">
                    <div className="border rounded-lg p-6">
                        <h2 className="text-2xl font-semibold mb-3">Plugin Page Registration</h2>
                        <p className="text-muted-foreground">
                            Plugins can register menu items that appear in the main navigation.
                            Each menu item can have an icon, category, order, and access controls.
                        </p>
                    </div>

                    <div className="border rounded-lg p-6">
                        <h2 className="text-2xl font-semibold mb-3">Plugin Pages</h2>
                        <p className="text-muted-foreground">
                            Plugins define pages with routes and React components. The system
                            automatically handles routing without modifying core infrastructure.
                        </p>
                    </div>

                    <div className="border rounded-lg p-6">
                        <h2 className="text-2xl font-semibold mb-3">Dynamic Registration</h2>
                        <p className="text-muted-foreground">
                            Pages and menu items are registered at runtime through the plugin
                            manifest, keeping features self-contained and easy to enable/disable.
                        </p>
                    </div>

                    <div className="border rounded-lg p-6">
                        <h2 className="text-2xl font-semibold mb-3">Zero Core Changes</h2>
                        <p className="text-muted-foreground">
                            Adding new features requires no changes to the core application.
                            Everything lives in the plugin directory.
                        </p>
                    </div>
                </div>

                <div className="mt-8 p-6 bg-primary/10 rounded-lg">
                    <h3 className="text-xl font-semibold mb-2">Try It Yourself</h3>
                    <p className="text-muted-foreground">
                        Look at this plugin's source code in{' '}
                        <code className="bg-background px-2 py-1 rounded">
                            packages/plugins/example-dashboard
                        </code>{' '}
                        to see how it's implemented. Then create your own!
                    </p>
                </div>
            </div>
        </div>
    );
}
