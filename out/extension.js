"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const file_url_definition_provider_ts_1 = require("./providers/file-url-definition-provider-ts");
const pug_url_definition_provider_1 = require("./providers/pug-url-definition-provider");
function activate(context) {
    const urlRegistration = vscode.languages.registerDefinitionProvider({
        language: 'typescript',
        pattern: '**/*.ts',
        scheme: 'file',
    }, new file_url_definition_provider_ts_1.FileUrlDefinitionProvider());
    const urlJadeRegistration = vscode.languages.registerDefinitionProvider({
        language: 'jade',
        pattern: '**/*.jade',
        scheme: 'file',
    }, new pug_url_definition_provider_1.PugUrlDefinitionProvider());
    const urlPugRegistration = vscode.languages.registerDefinitionProvider({
        language: 'pug',
        pattern: '**/*.pug',
        scheme: 'file',
    }, new pug_url_definition_provider_1.PugUrlDefinitionProvider());
    context.subscriptions.push(urlRegistration, urlPugRegistration, urlJadeRegistration);
}
exports.activate = activate;
// this method is called when your extension is deactivated
function deactivate() {
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map