// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileP = promisify(execFile);

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "vscode-pgf" is now active!');
	let viewDisposable = vscode.commands.registerCommand('vscode-pgf.viewPgf', async () => {
		const editor = vscode.window.activeTextEditor;
		let fileUri: vscode.Uri | undefined;
		if (editor && editor.document && !editor.document.isUntitled) {
			fileUri = editor.document.uri;
		}
		if (!fileUri) {
			const pick = await vscode.window.showOpenDialog({
				canSelectMany: false,
				openLabel: 'Open PGF',
				filters: { 'PGF': ['pgf'] }
			});
			if (!pick || pick.length === 0) {
				return;
			}
			fileUri = pick[0];
		}

		// Open the file with our custom editor
		await vscode.commands.executeCommand('vscode.openWith', fileUri, 'vscode-pgf.viewer');
	});


	// Helper: compile a PGF/TeX source to PDF in a temporary directory
	async function compilePgfToPdf(srcPath: string): Promise<{ tmpRoot: string; pdfPath: string }>{
		const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-pgf-'));
		const base = path.basename(srcPath, path.extname(srcPath));
		const dstSrc = path.join(tmpRoot, path.basename(srcPath));
		// copy the source into the temp dir so relative resources resolve
		await fs.promises.copyFile(srcPath, dstSrc);
		const texName = `${base}.tex`;
		const texPath = path.join(tmpRoot, texName);

		let srcText = '';
		try { srcText = await fs.promises.readFile(dstSrc, 'utf8'); } catch (e) { }

		function extractMatplotlibPreamble(text: string): string | null {
			const lines = text.split(/\r?\n/);
			let start = -1;
			for (let i = 0; i < lines.length; i++) {
				if (/^%+\s*Matplotlib used the following preamble/.test(lines[i])) { start = i + 1; break; }
			}
			if (start === -1) { return null; }
			const out: string[] = [];
			for (let i = start; i < lines.length; i++) {
				const line = lines[i];
				if (!/^%+\s{3}/.test(line)) { break; }
				out.push(line.replace(/^\s*%+\s*/, ''));
			}
			const result = out.join('\n').trim();
			return result.length ? result : null;
		}

		const matplotlibPreamble = extractMatplotlibPreamble(srcText);

		const texContent = `\\documentclass[border=1mm]{standalone}\n\\usepackage{pgf}\n\\usepackage{lmodern}\n${matplotlibPreamble ? matplotlibPreamble + '\n' : ''}\\begin{document}\n\\input{${srcPath}}\n\\end{document}\n`;
		await fs.promises.writeFile(texPath, texContent, 'utf8');

		try {
			await execFileP('pdflatex', ['-interaction=batchmode', '-output-directory', tmpRoot, texName], { cwd: tmpRoot });
		} catch (err: any) {
			const logPath = path.join(tmpRoot, `${base}.log`);
			let log = '';
			try { log = await fs.promises.readFile(logPath, 'utf8'); } catch (e) { }
			const short = (log && log.length > 200) ? log.slice(0,200) + '...' : log || String(err.message || err);
			console.error('PGF build log:\n', log);
			throw new Error('Failed to build PGF: ' + short);
		}

		const pdfPath = path.join(tmpRoot, `${base}.pdf`);
		if (!fs.existsSync(pdfPath)) {
			throw new Error('PDF not produced. Ensure `pdflatex` is installed.');
		}
		console.log('PGF compiled to PDF at', pdfPath);
		return { tmpRoot, pdfPath };
	}

	// Rasterize PDF to PNG using available tools (pdftocairo, pdftoppm, convert)
	async function renderPdfToPng(pdfPath: string, tmpRoot: string): Promise<string> {
	 	const base = path.basename(pdfPath, path.extname(pdfPath));
	 	const outPrefix = path.join(tmpRoot, base);
	 	let pngPath = path.join(tmpRoot, `${base}.png`);
		// Try pdftocairo
		try {
			await execFileP('pdftocairo', ['-png', '-singlefile', pdfPath, outPrefix]);
			if (fs.existsSync(pngPath)) { return pngPath; }
		} catch (e) {
			// ignore
		}
		// Try pdftoppm
		try {
			await execFileP('pdftoppm', ['-png', '-singlefile', pdfPath, outPrefix]);
			if (fs.existsSync(pngPath)) { return pngPath; }
		} catch (e) {
			// ignore
		}
		// Try ImageMagick convert
		try {
			await execFileP('convert', ['-density', '300', pdfPath, pngPath]);
			if (fs.existsSync(pngPath)) { return pngPath; }
		} catch (e) {
			// ignore
		}
		throw new Error('No rasterizer found: please install pdftocairo, pdftoppm, or ImageMagick `convert`.');
	}

	// Class-based provider implementing full resolveCustomEditor signature
	class PgfViewerProvider implements vscode.CustomReadonlyEditorProvider {
		public async openCustomDocument(uri: vscode.Uri, _context: vscode.CustomDocumentOpenContext, _token: vscode.CancellationToken): Promise<vscode.CustomDocument> {
			const doc: any = { uri, dispose: () => { /* noop */ } };
			return doc as vscode.CustomDocument;
		}
		public async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken) {
			const srcPath = document.uri.fsPath;
			try {
				const { tmpRoot, pdfPath } = await compilePgfToPdf(srcPath);
				webviewPanel.webview.options = { enableScripts: false, localResourceRoots: [vscode.Uri.file(tmpRoot)] };
				// Try to rasterize PDF to PNG and open with VS Code's built-in image viewer
				try {
					const pngPath = await renderPdfToPng(pdfPath, tmpRoot);
					const imgUri = vscode.Uri.file(pngPath);
					// Open the PNG using the built-in image preview
					await vscode.commands.executeCommand('vscode.open', imgUri);
					// Close the custom editor panel since we've handed off to the native viewer
					try { webviewPanel.dispose(); } catch { /* ignore */ }
					return;
				} catch (e: any) {
					// Fallback: offer to open the PDF externally
					const pdfUri = webviewPanel.webview.asWebviewUri(vscode.Uri.file(pdfPath));
					webviewPanel.webview.html = `<html><body><p>Could not rasterize PDF: ${String(e.message || e)}</p><p><a href="${pdfUri}">Open PDF externally</a></p></body></html>`;
				}
			} catch (err: any) {
				webviewPanel.webview.html = `<html><body><pre>Error: ${String(err.message || err)}</pre></body></html>`;
			}
		}
	}

	context.subscriptions.push(vscode.window.registerCustomEditorProvider('vscode-pgf.viewer', new PgfViewerProvider(), { webviewOptions: { retainContextWhenHidden: true } }));

	context.subscriptions.push(viewDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
