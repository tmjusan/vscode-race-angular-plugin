import * as vscode from 'vscode';
import { FileUrlDefinitionProvider } from './providers/file-url-definition-provider-ts';
import { PugUrlDefinitionProvider } from './providers/pug-url-definition-provider';

export function activate(context: vscode.ExtensionContext) {
	  const urlRegistration = vscode.languages.registerDefinitionProvider(
		  {
			    language: 'typescript',
			    pattern: '**/*.ts',
			    scheme: 'file',
		  },
  	      new FileUrlDefinitionProvider()
	  );
	  
	    const urlPugRegistration = vscode.languages.registerDefinitionProvider(
		  {
			  language: 'jade',
		  	pattern: '**/*.{jade,pug}',
			  scheme: 'file',
		  },
  	      new PugUrlDefinitionProvider()
  	  );

  	  context.subscriptions.push(
		  	urlRegistration,
		   	urlPugRegistration
  	  );
}

// this method is called when your extension is deactivated
export function deactivate() {

}
