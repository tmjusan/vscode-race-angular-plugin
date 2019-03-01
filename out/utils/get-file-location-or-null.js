"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
function getFileLocationOrNull(document, originSelectionRange, relativeUri, relativePath = relativeUri) {
    return new Promise(resolve => {
        if (document !== null && document !== undefined &&
            originSelectionRange !== null && originSelectionRange !== undefined &&
            relativePath !== null && relativePath !== undefined) {
            const fullPath = path.resolve(path.dirname(document.fileName), relativePath);
            if (fullPath !== null && fullPath !== undefined) {
                fs.open(fullPath, 'r', (error, fd) => {
                    if (error !== null && error !== undefined) {
                        resolve(null);
                    }
                    else {
                        const locations = [{
                                originSelectionRange: originSelectionRange,
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