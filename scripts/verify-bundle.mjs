import { readFile, readdir } from "node:fs/promises";
import ts from "typescript";

const folder = new URL("../.daily-plugin/dist/", import.meta.url);
for (const name of await readdir(folder)) {
  if (!name.endsWith(".js")) continue;
  const source = await readFile(new URL(name, folder), "utf8");
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function visit(node) {
    const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : null;
    if (specifier && ts.isStringLiteral(specifier) && !specifier.text.startsWith("./") && !specifier.text.startsWith("../")) {
      throw new Error(`${name} contains an unresolved import: ${specifier.text}`);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      throw new Error(`${name} contains CommonJS require.`);
    }
    if (ts.isPropertyAccessExpression(node) && node.getText(file) === "process.env") {
      throw new Error(`${name} contains Node process environment.`);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (name === "plugin.js" && !file.statements.some((node) => ts.isExportAssignment(node) || ts.isExportDeclaration(node))) {
    throw new Error("Plugin entry must export its definition.");
  }
}
