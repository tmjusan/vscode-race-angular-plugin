import * as vscode from 'vscode';
import { getFileLocationOrNull } from '../utils/get-file-location-or-null';

export class FileUrlDefinitionProvider implements vscode.DefinitionProvider {

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.LocationLink[]> {
        const wordRange = document.getWordRangeAtPosition(position, /(['"])((?:[^<>:;,?"*|\\\/]+)?[\\\/](?:[^<>:;,?"*|\\\/]+))+\1/g);
        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null;

        if (wordRange !== null && wordRange !== undefined) {
            let relativeUri = document.getText(wordRange);
            let match = /[^<>:;,?"*|]+/g.exec(relativeUri);
            if (match !== null) {
                relativeUri = match[0];
            } else {
                relativeUri = relativeUri.substring(1, relativeUri.length - 1);
            }
            result = getFileLocationOrNull(document, position, relativeUri);
        } else {
            result = null;
        }

        return result;
    }

}