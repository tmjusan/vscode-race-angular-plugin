import * as vscode from 'vscode';
import { getFileLocationOrNull } from '../utils/get-file-location-or-null';
import { getFullPathOrNull } from '../utils/get-full-path-or-null';
import { CheckFileResult } from '../interfaces/check-file-result';
import { clearTimeout } from 'timers';

export class PugUrlDefinitionProvider implements vscode.DefinitionProvider {

    private readonly _tagSelectorRegex = /^((?!include|\.)(?:\s+)?[a-zA-Z0-9_-]+)((?:\.[a-zA-Z_-]+)+)?((?:\s+)?\((?:(?:(?:\s+)?[^\s]+(?:\s+)?=(?:\s+)?(?:(?:(['"])[^\n\r]+\4)|(?:require(?:\s+)?\(["'][^\s"']+["']\)))\,?)|(?:(?:\s+)?(?:#|)[a-zA-Z-_]+)\,?(?:\s+)?)+\))?/gm;

    private readonly _tagUriCache: {[tagName: string]: Array<vscode.Uri>} = {};
    private _tagClearCacheTimeout: {[tagName: string]: NodeJS.Timeout} = {};
    
    private _checkIncludesUri(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        const wordRange = document.getWordRangeAtPosition(position, /[\s+]?include[\s]+((?:(?:[^<>:;,?"*|\\\/\n\r]+)?[\\\/](?:[^<>:;,?"*|\\\/\n\r]+))+)/g);
        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null;

        if (wordRange !== null && wordRange !== undefined) {
            let relativeUri = document.getText(wordRange);
            let match = /[\s+]?include[\s]+((?:(?:[^<>:;,?"*|\\\/\n\r]+)?[\\\/](?:[^<>:;,?"*|\\\/\n\r]+))+)/g.exec(relativeUri);
            if (match !== null) {
                relativeUri = match[1];
            }
            if (relativeUri !== null && relativeUri !== undefined) {
                if (relativeUri.endsWith('.pug') || relativeUri.endsWith('.jade')) {
                    result = getFileLocationOrNull(document, position, relativeUri);
                } else {
                    result = new Promise<Array<vscode.LocationLink> | null>(resolve => {
                        Promise.all([
                            getFileLocationOrNull(document, position, `${relativeUri}.pug`),
                            getFileLocationOrNull(document, position, `${relativeUri}.jade`)
                        ]).then(results => {
                            for (let result of results) {
                                if (result) {
                                    resolve(result);
                                    return;
                                }
                            }
                            resolve(null);
                        }).catch(errors => {
                            resolve(null);
                        });
                    });
                }
            } else {
                result = null;
            }
        } else {
            result = null;
        }

        return result;
    }

    private _checkFileContainsMixin(mixin: string, filePath: string, originSelectionRange?: vscode.Range): Promise<vscode.LocationLink | null> {
        return new Promise<vscode.LocationLink | null>(resolve => {
            const regex = new RegExp(`^(?:[\\n\\r]?[\\s]+)?mixin(?:[\\s]+)?${mixin.startsWith('+') ? mixin.substr(1) : mixin}`, 'gm');
            vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
                .then(pugFileDocument => {
                    const documentText = pugFileDocument.getText();
                    const match = regex.exec(documentText);
                    if (match) {
                        const identaionRegex = /[\s]+/;
                        const startPosition = pugFileDocument.positionAt(match.index + 1);
                        const mixinIndentation: number = startPosition.character;
                        let endLineNumber = startPosition.line;
                        let endCharacterNumber = -1;
                        while (++endLineNumber < pugFileDocument.lineCount && endCharacterNumber < 0) {
                            const line = pugFileDocument.lineAt(endLineNumber);
                            const match = identaionRegex.exec(line.text);
                            if (match && match[0] && match[0].length <= mixinIndentation) {
                                endCharacterNumber = line.text.length;
                            } else if (match === null || match === undefined) {
                                endCharacterNumber = pugFileDocument.lineAt(--endLineNumber).text.length;
                            }
                        }
                        const endPosition = new vscode.Position(endLineNumber, endCharacterNumber);
                        const link: vscode.LocationLink = {
                            originSelectionRange: originSelectionRange,
                            targetUri: vscode.Uri.file(filePath),
                            targetRange: new vscode.Range(startPosition, endPosition),
                            targetSelectionRange: new vscode.Range(startPosition, 
                                new vscode.Position(
                                    startPosition.line, 
                                    pugFileDocument.lineAt(startPosition.line).text.length
                                    )
                                )
                        };
                        resolve(link);
                    } else {
                        resolve(null);
                    }
                }, errors => {
                    resolve(null);
                });
        });
    }

    private _getIncludesPaths(document: vscode.TextDocument): Promise<Array<string>> {
        return new Promise<Array<string>>(resolve => {
            const result: Array<string> = [];
            const documentText = document.getText();
            const regex = /[\s+]?include[\s]+((?:(?:[^<>:;,?"*|\\\/\n\r]+)?[\\\/](?:[^<>:;,?"*|\\\/\n\r]+))+)/g;
            let match;
            const fileCheckTasks: Array<Promise<string | null>> = [];
            while (match = regex.exec(documentText)) {
                const includeFileName = match[1];
                if (includeFileName !== null && includeFileName !== undefined) {
                    if (includeFileName.endsWith('.jade') || includeFileName.endsWith('.pug')) {
                        fileCheckTasks.push(getFullPathOrNull(document, includeFileName));
                    } else {
                        fileCheckTasks.push(getFullPathOrNull(document, `${includeFileName}.pug`));
                        fileCheckTasks.push(getFullPathOrNull(document, `${includeFileName}.jade`));
                    }
                }
            }
            Promise.all(fileCheckTasks)
                .then(results => {
                    for (let value of results) {
                        if (value !== null && value !== undefined) {
                            result.push(value);
                        }
                    }
                    resolve(result);
                }).catch(errors => {
                    if (errors !== null && errors !== undefined) {
                        console.error(errors);
                    }
                    resolve(result);
                });
        });
    }

    private _checkMixinsUri(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        const wordRange = document.getWordRangeAtPosition(position, /^(?:[\s]+)?\+([^()\+\s]+)/gm);

        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null;
        if (wordRange !== null && wordRange !== undefined) {
            let mixinName = document.getText(wordRange);
            let match = /\+[^+\(\s]+/g.exec(mixinName);
            if (match !== null) {
                mixinName = match[0];
            }
            if (mixinName !== null && mixinName !== undefined) {
                result = new Promise<Array<vscode.LocationLink> | null>(resolve => {
                    let filePaths: Array<string> = [
                        document.fileName
                    ];
                    const findMixinTasks: Array<Promise<vscode.LocationLink | null>> = [];
                    const links: Array<vscode.LocationLink> = [];
                    this._getIncludesPaths(document)
                        .then(paths => {
                            filePaths = [...filePaths, ...paths];
                            let range: vscode.Range = (match !== null && match !== undefined) ? new vscode.Range(
                                new vscode.Position(wordRange.start.line, match.index),
                                new vscode.Position(wordRange.start.line, match.index + match[0].length)
                            ) : wordRange;
                            for (let path of filePaths) {
                                findMixinTasks.push(
                                    this._checkFileContainsMixin(mixinName, path, range)
                                );
                            }
                            Promise.all(findMixinTasks)
                                .then(results => {
                                    for (let result of results) {
                                        if (result !== null && result !== undefined) {
                                            links.push(result);
                                        }
                                    }
                                    resolve(links);
                                }).catch(errors => {
                                    if (errors !== null && errors !== undefined) {
                                        console.error(errors);
                                    }
                                    resolve(null);
                                });
                        }).catch(errors => {
                            if (errors !== null && errors !== undefined) {
                                console.error(errors);
                            }
                            resolve(null);
                        });
                });
            } else {
                result = null;
            }
        } else {
            result = null;
        }

        return result;
    }

    private _checkFileForTagName(tagName: string, uri: vscode.Uri, originSelectionRange: vscode.Range, token: vscode.CancellationToken): Promise<CheckFileResult> {
        return new Promise<CheckFileResult>((resolve, reject) => {
            if (token.isCancellationRequested) {
                reject(null);
                return;
            }
            vscode.workspace.openTextDocument(uri)
                .then(document => {
                    const tagRegex = new RegExp(`@(Component|Directive)(?:\\s+)?\\((?:\\s+)?\\{(?:[^]+)?selector(?:\\s+)?:(?:\\s+)?([\'\"])${tagName}\\2\\,?(?:[^]+)?\\}(?:\\s+)?\\)`, "i");
                    const match = tagRegex.exec(document.getText());
                    if (match) {
                        const startPosition = document.positionAt(match.index);
                        const endPosition = document.positionAt(match.index + match[0].length);
                        const link: vscode.LocationLink = {
                            originSelectionRange: originSelectionRange,
                            targetUri: vscode.Uri.file(document.fileName),
                            targetRange: new vscode.Range(startPosition, endPosition),
                            targetSelectionRange: new vscode.Range(startPosition, 
                                new vscode.Position(
                                    startPosition.line, 
                                    document.lineAt(startPosition.line).text.length
                                    )
                                )
                        };
                        resolve({
                            uri: uri,
                            location: link
                        });
                    } else {
                        resolve({uri: uri, location: null});
                    }
                }, error => {
                    reject(error);
                });
        });
    }

    private _findLocationWithTagNameCached(tagName: string, originSelectionRange: vscode.Range, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> {
        if (this._tagUriCache[tagName] === null || this._tagUriCache[tagName] === undefined) {
            return Promise.reject(null);
        }
        return new Promise<Array<vscode.LocationLink> | null>((resolve, reject) => {
            let result: Array<vscode.LocationLink> = [];
            let checkTasks: Array<Promise<CheckFileResult>> = [];
            for (let uri of this._tagUriCache[tagName]) {
                checkTasks.push(
                    this._checkFileForTagName(tagName, uri, originSelectionRange, token)
                );
            }
            Promise.all(checkTasks)
                .then(results => {
                    for (let checkResult of results) {
                        if (checkResult.location !== null && checkResult.location !== undefined) {
                            // Filter similar results
                            const findResult = result.find(loc => {
                                return checkResult.location !== null && checkResult.location !== undefined &&
                                    loc !== null && loc !== undefined && 
                                    loc.targetUri.path === checkResult.location.targetUri.path;
                            });
                            if (findResult === null || findResult === undefined) {
                                result.push(checkResult.location);
                            }
                        }
                    }
                    if (result.length > 0) {
                        resolve(result);
                    } else {
                        reject(null);
                    }
                }).catch(error => {
                    reject(error);
                });
        });
    }

    private _findLocationsWithTagName(tag: string, originSelectionRange: vscode.Range, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null>  {
        if (tag === null || tag === undefined) {
            return Promise.resolve(null);
        }
        return new Promise<Array<vscode.LocationLink> | null>(resolve => {
            this._findLocationWithTagNameCached(tag, originSelectionRange, token)
                .then(results => {
                    resolve(results);
                })
                .catch(() => {
                    vscode.workspace.findFiles("**/*.{component,directive}.ts", "node_modules/*")
                        .then(sourceFiles => {
                            let result: Array<vscode.LocationLink> = [];
                            let checkTasks: Array<Promise<CheckFileResult>> = [];
                            for (let file of sourceFiles) {
                                checkTasks.push(
                                    this._checkFileForTagName(tag, file, originSelectionRange, token)
                                );
                            }
                            Promise.all(checkTasks)
                                .then(results => {
                                    for (let checkResult of results) {
                                        if (checkResult.location !== null && checkResult.location !== undefined) {
                                            if (this._tagUriCache[tag] === null || this._tagUriCache[tag] === undefined) {
                                                this._tagUriCache[tag] = [];
                                            }
                                            this._tagUriCache[tag].push(checkResult.uri);
                                            // Filter similar results
                                            const findResult = result.find(loc => {
                                                return checkResult.location !== null && checkResult.location !== undefined &&
                                                    loc !== null && loc !== undefined && 
                                                    loc.targetUri.path === checkResult.location.targetUri.path;
                                            });
                                            if (findResult === null || findResult === undefined) {
                                                result.push(checkResult.location);
                                            }
                                        }
                                    }
                                    if (this._tagUriCache[tag] !== null && this._tagUriCache[tag] !== undefined) {
                                        if (this._tagClearCacheTimeout[tag] !== null && this._tagClearCacheTimeout[tag] !== undefined) {
                                            clearTimeout(this._tagClearCacheTimeout[tag]);
                                        }
                                        this._tagClearCacheTimeout[tag] = setTimeout(() => {
                                            delete this._tagUriCache[tag];
                                            delete this._tagClearCacheTimeout[tag];
                                        }, 60 * 1000); // cache for 1 minute
                                    }
                                    resolve(result);
                                }).catch(errors => {
                                    if (errors !== null && errors !== undefined) {
                                        console.error(errors);
                                    }
                                    resolve(null);
                                });
                        });
                });
        });
    }

    private _checkNgSelectorUri(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        const tagSelectorRegex = new RegExp(this._tagSelectorRegex, "gm");
        const wordRange = document.getWordRangeAtPosition(position, tagSelectorRegex);
        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null = null;

        if (wordRange !== null && wordRange !== undefined) {
            const line = document.lineAt(wordRange.start);
            let tagMatch = /^(?:(?!include|\.)(?:\s+)?([a-zA-Z0-9_-]+))/.exec(line.text);
            if (tagMatch) {
                const tagName = tagMatch[1];
                const originSelectionRange: vscode.Range = new vscode.Range(
                    new vscode.Position(line.lineNumber, line.firstNonWhitespaceCharacterIndex),
                    new vscode.Position(line.lineNumber, line.firstNonWhitespaceCharacterIndex + (tagName && tagName.length || 0))
                );
                result = this._findLocationsWithTagName(tagName, originSelectionRange, token);
            }
        }

        return result;
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.LocationLink[]> {
        return this._checkIncludesUri(document, position, token) || 
            this._checkMixinsUri(document, position, token) || 
            this._checkNgSelectorUri(document, position, token);
    }

}