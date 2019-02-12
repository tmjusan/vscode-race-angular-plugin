import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function getFullPathOrNull(document: vscode.TextDocument, relativePath: string): Promise<string | null> {
    return new Promise<string | null>(resolve => {
        if (document !== null && document !== undefined && 
            relativePath !== null && relativePath !== undefined) {
            const fullPath = path.resolve(path.dirname(document.fileName), relativePath);
            if (fullPath !== null && fullPath !== undefined) {
                fs.open(fullPath, 'r', (error, fd) => {
                    if (error) {
                        resolve(null);
                    } else {
                        fs.close(fd, error => {
                            resolve(fullPath);
                        });
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