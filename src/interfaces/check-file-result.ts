import * as vscode from 'vscode';

export interface CheckFileResult {
    uri: vscode.Uri;
    location: vscode.LocationLink | null;
}