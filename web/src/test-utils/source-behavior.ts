import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";

// Execute production callbacks with explicit dependencies, without importing the
// entire editor or copying its logic. No global module mocks leak into other tests.
export function sourceBehavior(url: URL, bindings: Record<string, unknown> = {}) {
    const source = ts.createSourceFile(url.pathname, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function evaluate(node: ts.Node) {
        const code = ts.transpileModule(`const value = ${node.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
        return new Function("React", ...Object.keys(bindings), `${code}\nreturn value;`)(React, ...Object.values(bindings));
    }
    return {
        select(predicate: (node: ts.Node) => boolean) {
            const matches: ts.Node[] = [];
            function visit(node: ts.Node) {
                if (predicate(node)) matches.push(node);
                ts.forEachChild(node, visit);
            }
            visit(source);
            assert.equal(matches.length, 1, "production callback must resolve unambiguously");
            return evaluate(matches[0]);
        },
        named(name: string) {
            return this.select((node) =>
                (ts.isFunctionDeclaration(node) && node.name?.text === name) ||
                (!!node.parent && ts.isVariableDeclaration(node.parent) && node.parent.name.getText(source) === name && node.parent.initializer === node),
            );
        },
    };
}
