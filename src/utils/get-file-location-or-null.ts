import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function getFileLocationOrNull(document: vscode.TextDocument, originSelectionRange: vscode.Range, relativeUri: string, relativePath: string = relativeUri): Promise<Array<vscode.LocationLink> | null> {
    return new Promise<Array<vscode.LocationLink> | null>(resolve => {
        if (document !== null && document !== undefined && 
            originSelectionRange !== null && originSelectionRange !== undefined && 
            relativePath !== null && relativePath !== undefined) {
            const fullPath = path.resolve(path.dirname(document.fileName), relativePath);
            if (fullPath !== null && fullPath !== undefined) {
                fs.open(fullPath, 'r', (error, fd) => {
                    if (error !== null && error !== undefined) {
                        resolve(null);
                    } else {
                        const locations = [{
                            originSelectionRange: originSelectionRange,
                            targetUri: vscode.Uri.file(fullPath),
                            targetRange: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0))
                        }];
                        resolve(locations);
                    }
                });
            } else {
                resolve(null);
            }
        } else {
            resolve(null);
        }
    });
}