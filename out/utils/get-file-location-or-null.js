"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
function getFileLocationOrNull(document, position, relativeUri, relativePath = relativeUri) {
    return new Promise(resolve => {
        if (document !== null && document !== undefined &&
            position !== null && position !== undefined &&
            relativePath !== null && relativePath !== undefined) {
            const containingLine = document.lineAt(position.line).text;
            const fullPath = path.resolve(path.dirname(document.fileName), relativePath);
            if (containingLine !== null && containingLine !== undefined &&
                fullPath !== null && fullPath !== undefined) {
                fs.open(fullPath, 'r', (error, fd) => {
                    if (error !== null && error !== undefined) {
                        resolve(null);
                    }
                    else {
                        let startIndex = containingLine.indexOf(relativeUri);
                        let endIndex = containingLine.indexOf(relativeUri) + relativeUri.length;
                        if (startIndex < 0) {
                            let end = relativeUri.length;
                            while (startIndex < 0 && --end > 0) {
                                startIndex = containingLine.indexOf(relativeUri.substring(0, end));
                                if (startIndex >= 0) {
                                    relativeUri = relativeUri.substring(0, end);
                                    endIndex = containingLine.indexOf(relativeUri) + relativeUri.length;
                                }
                            }
                        }
                        const startPos = new vscode.Position(position.line, startIndex || 0);
                        const endPos = new vscode.Position(position.line, endIndex || containingLine.length);
                        const locations = [{
                                originSelectionRange: new vscode.Range(startPos, endPos),
                                targetUri: vscode.Uri.file(fullPath),
                                targetRange: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0))
                            }];
                        resolve(locations);
                    }
                });
            }
            else {
                resolve(null);
            }
        }
        else {
            resolve(null);
        }
    });
}
exports.getFileLocationOrNull = getFileLocationOrNull;
//# sourceMappingURL=get-file-location-or-null.js.map