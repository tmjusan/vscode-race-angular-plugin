"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const get_file_location_or_null_1 = require("../utils/get-file-location-or-null");
const get_full_path_or_null_1 = require("../utils/get-full-path-or-null");
const timers_1 = require("timers");
class PugUrlDefinitionProvider {
    constructor() {
        this._tagSelectorRegex = /^((?!include|\.)(?:\s+)?[a-zA-Z0-9_-]+)((?:\.[a-zA-Z_-]+)+)?((?:\s+)?\((?:(?:(?:\s+)?[^\s]+(?:\s+)?=(?:\s+)?(?:(?:(['"])[^\n\r]+\4)|(?:require(?:\s+)?\(["'][^\s"']+["']\)))\,?)|(?:(?:\s+)?(?:#|)[a-zA-Z-_]+)\,?(?:\s+)?)+\))?/gm;
        this._tagUriCache = {};
        this._tagClearCacheTimeout = {};
    }
    _checkIncludesUri(document, position, token) {
        const wordRange = document.getWordRangeAtPosition(position, /[\s+]?include[\s]+((?:(?:[^<>:;,?"*|\\\/\n\r]+)?[\\\/](?:[^<>:;,?"*|\\\/\n\r]+))+)/g);
        let result;
        if (wordRange !== null && wordRange !== undefined) {
            let relativeUri = document.getText(wordRange);
            let match = /[\s+]?include[\s]+((?:(?:[^<>:;,?"*|\\\/\n\r]+)?[\\\/](?:[^<>:;,?"*|\\\/\n\r]+))+)/g.exec(relativeUri);
            if (match !== null) {
                relativeUri = match[1];
            }
            if (relativeUri !== null && relativeUri !== undefined) {
                if (relativeUri.endsWith('.pug') || relativeUri.endsWith('.jade')) {
                    result = get_file_location_or_null_1.getFileLocationOrNull(document, position, relativeUri);
                }
                else {
                    result = new Promise(resolve => {
                        Promise.all([
                            get_file_location_or_null_1.getFileLocationOrNull(document, position, `${relativeUri}.pug`),
                            get_file_location_or_null_1.getFileLocationOrNull(document, position, `${relativeUri}.jade`)
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
            }
            else {
                result = null;
            }
        }
        else {
            result = null;
        }
        return result;
    }
    _checkFileContainsMixin(mixin, filePath, originSelectionRange) {
        return new Promise(resolve => {
            const regex = new RegExp(`^(?:[\\n\\r]?[\\s]+)?mixin(?:[\\s]+)?${mixin.startsWith('+') ? mixin.substr(1) : mixin}`, 'gm');
            vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
                .then(pugFileDocument => {
                const documentText = pugFileDocument.getText();
                const match = regex.exec(documentText);
                if (match) {
                    const identaionRegex = /[\s]+/;
                    const startPosition = pugFileDocument.positionAt(match.index + 1);
                    const mixinIndentation = startPosition.character;
                    let endLineNumber = startPosition.line;
                    let endCharacterNumber = -1;
                    while (++endLineNumber < pugFileDocument.lineCount && endCharacterNumber < 0) {
                        const line = pugFileDocument.lineAt(endLineNumber);
                        const match = identaionRegex.exec(line.text);
                        if (match && match[0] && match[0].length <= mixinIndentation) {
                            endCharacterNumber = line.text.length;
                        }
                        else if (match === null || match === undefined) {
                            endCharacterNumber = pugFileDocument.lineAt(--endLineNumber).text.length;
                        }
                    }
                    const endPosition = new vscode.Position(endLineNumber, endCharacterNumber);
                    const link = {
                        originSelectionRange: originSelectionRange,
                        targetUri: vscode.Uri.file(filePath),
                        targetRange: new vscode.Range(startPosition, endPosition),
                        targetSelectionRange: new vscode.Range(startPosition, new vscode.Position(startPosition.line, pugFileDocument.lineAt(startPosition.line).text.length))
                    };
                    resolve(link);
                }
                else {
                    resolve(null);
                }
            }, errors => {
                resolve(null);
            });
        });
    }
    _getIncludesPaths(document) {
        return new Promise(resolve => {
            const result = [];
            const documentText = document.getText();
            const regex = /[\s+]?include[\s]+((?:(?:[^<>:;,?"*|\\\/\n\r]+)?[\\\/](?:[^<>:;,?"*|\\\/\n\r]+))+)/g;
            let match;
            const fileCheckTasks = [];
            while (match = regex.exec(documentText)) {
                const includeFileName = match[1];
                if (includeFileName !== null && includeFileName !== undefined) {
                    if (includeFileName.endsWith('.jade') || includeFileName.endsWith('.pug')) {
                        fileCheckTasks.push(get_full_path_or_null_1.getFullPathOrNull(document, includeFileName));
                    }
                    else {
                        fileCheckTasks.push(get_full_path_or_null_1.getFullPathOrNull(document, `${includeFileName}.pug`));
                        fileCheckTasks.push(get_full_path_or_null_1.getFullPathOrNull(document, `${includeFileName}.jade`));
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
    _checkMixinsUri(document, position, token) {
        const wordRange = document.getWordRangeAtPosition(position, /^(?:[\s]+)?\+([^()\+\s]+)/gm);
        let result;
        if (wordRange !== null && wordRange !== undefined) {
            let mixinName = document.getText(wordRange);
            let match = /\+[^+\(\s]+/g.exec(mixinName);
            if (match !== null) {
                mixinName = match[0];
            }
            if (mixinName !== null && mixinName !== undefined) {
                result = new Promise(resolve => {
                    let filePaths = [
                        document.fileName
                    ];
                    const findMixinTasks = [];
                    const links = [];
                    this._getIncludesPaths(document)
                        .then(paths => {
                        filePaths = [...filePaths, ...paths];
                        let range = (match !== null && match !== undefined) ? new vscode.Range(new vscode.Position(wordRange.start.line, match.index), new vscode.Position(wordRange.start.line, match.index + match[0].length)) : wordRange;
                        for (let path of filePaths) {
                            findMixinTasks.push(this._checkFileContainsMixin(mixinName, path, range));
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
            }
            else {
                result = null;
            }
        }
        else {
            result = null;
        }
        return result;
    }
    _checkFileForTagName(tagName, uri, originSelectionRange, token) {
        return new Promise((resolve, reject) => {
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
                    const link = {
                        originSelectionRange: originSelectionRange,
                        targetUri: vscode.Uri.file(document.fileName),
                        targetRange: new vscode.Range(startPosition, endPosition),
                        targetSelectionRange: new vscode.Range(startPosition, new vscode.Position(startPosition.line, document.lineAt(startPosition.line).text.length))
                    };
                    resolve({
                        uri: uri,
                        location: link
                    });
                }
                else {
                    resolve({ uri: uri, location: null });
                }
            }, error => {
                reject(error);
            });
        });
    }
    _findLocationWithTagNameCached(tagName, originSelectionRange, token) {
        if (this._tagUriCache[tagName] === null || this._tagUriCache[tagName] === undefined) {
            return Promise.reject(null);
        }
        return new Promise((resolve, reject) => {
            let result = [];
            let checkTasks = [];
            for (let uri of this._tagUriCache[tagName]) {
                checkTasks.push(this._checkFileForTagName(tagName, uri, originSelectionRange, token));
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
                }
                else {
                    reject(null);
                }
            }).catch(error => {
                reject(error);
            });
        });
    }
    _findLocationsWithTagName(tag, originSelectionRange, token) {
        if (tag === null || tag === undefined) {
            return Promise.resolve(null);
        }
        return new Promise(resolve => {
            this._findLocationWithTagNameCached(tag, originSelectionRange, token)
                .then(results => {
                resolve(results);
            })
                .catch(() => {
                vscode.workspace.findFiles("**/*.{component,directive}.ts", "node_modules/*")
                    .then(sourceFiles => {
                    let result = [];
                    let checkTasks = [];
                    for (let file of sourceFiles) {
                        checkTasks.push(this._checkFileForTagName(tag, file, originSelectionRange, token));
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
                                timers_1.clearTimeout(this._tagClearCacheTimeout[tag]);
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
    _checkNgSelectorUri(document, position, token) {
        const tagSelectorRegex = new RegExp(this._tagSelectorRegex, "gm");
        const wordRange = document.getWordRangeAtPosition(position, tagSelectorRegex);
        let result = null;
        if (wordRange !== null && wordRange !== undefined) {
            const line = document.lineAt(wordRange.start);
            let tagMatch = /^(?:(?!include|\.)(?:\s+)?([a-zA-Z0-9_-]+))/.exec(line.text);
            if (tagMatch) {
                const tagName = tagMatch[1];
                const originSelectionRange = new vscode.Range(new vscode.Position(line.lineNumber, line.firstNonWhitespaceCharacterIndex), new vscode.Position(line.lineNumber, line.firstNonWhitespaceCharacterIndex + (tagName && tagName.length || 0)));
                result = this._findLocationsWithTagName(tagName, originSelectionRange, token);
            }
        }
        return result;
    }
    _checkTagAttributeSelectorUri(document, position, token) {
        const tagSelectorRegex = new RegExp(this._tagSelectorRegex, "gm");
        const wordRange = document.getWordRangeAtPosition(position, tagSelectorRegex);
        let result = null;
        if (wordRange !== null && wordRange !== undefined) {
            const line = document.lineAt(wordRange.start);
            let tagMatch = /^(?:(?!include|\.)(?:\s+)?([a-zA-Z0-9_-]+))/.exec(line.text);
            if (tagMatch) {
                const tagName = tagMatch[1];
                const originSelectionRange = new vscode.Range(new vscode.Position(line.lineNumber, line.firstNonWhitespaceCharacterIndex), new vscode.Position(line.lineNumber, line.firstNonWhitespaceCharacterIndex + (tagName && tagName.length || 0)));
                result = this._findLocationsWithTagName(tagName, originSelectionRange, token);
            }
        }
        return result;
    }
    provideDefinition(document, position, token) {
        return this._checkIncludesUri(document, position, token) ||
            this._checkMixinsUri(document, position, token) ||
            this._checkNgSelectorUri(document, position, token);
    }
}
exports.PugUrlDefinitionProvider = PugUrlDefinitionProvider;
//# sourceMappingURL=pug-url-definition-provider.js.map