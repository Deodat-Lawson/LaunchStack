// @ts-nocheck — build plumbing: babel's type package is not a dependency of
// this workspace, and the plugin is ~20 lines against a stable AST API.
/**
 * Babel plugin for jest only: rewrites `import.meta.url` to the file URL of
 * the module babel-jest is compiling. The workspace packages are ESM and a few
 * resolve assets relative to `import.meta.url` (the repo-explainer skills, the
 * distribution playbooks); under jest's CommonJS transform that syntax is a
 * parse error, which kept every test that touched those barrels out of jest.
 */
/**
 * @param {import("@babel/core")} babel
 * @returns {import("@babel/core").PluginObj}
 */
module.exports = function importMetaUrl({ types: t }) {
    return {
        name: "jest-import-meta-url",
        visitor: {
            MemberExpression(path) {
                const { object, property } = path.node;
                if (
                    t.isMetaProperty(object) &&
                    object.meta.name === "import" &&
                    object.property.name === "meta" &&
                    t.isIdentifier(property, { name: "url" })
                ) {
                    path.replaceWith(
                        t.callExpression(
                            t.memberExpression(
                                t.callExpression(t.identifier("require"), [t.stringLiteral("url")]),
                                t.identifier("pathToFileURL")
                            ),
                            [t.identifier("__filename")]
                        )
                    );
                    path.replaceWith(t.memberExpression(path.node, t.identifier("href")));
                }
            },
        },
    };
};
