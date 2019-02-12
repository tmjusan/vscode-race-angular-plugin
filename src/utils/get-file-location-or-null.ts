import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function getFileLocationOrNull(document: vscode.TextDocument, position: vscode.Position, relativeUri: string, relativePath: string = relativeUri): Promise<Array<vscode.LocationLink> | null> {
    return new Promise<Array<vscode.LocationLink> | null>(resolve => {
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
                    } else {
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
                        const startPos: vscode.Position = new vscode.Position(position.line, startIndex || 0);
                        const endPos: vscode.Position = new vscode.Position(position.line, endIndex || containingLine.length);
                        const locations = [{
                            originSelectionRange: new vscode.Range(startPos, endPos),
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