# vscode-pgf

A small VS Code extension to preview PGF output produced by tools like Matplotlib.

**What it does**

- Compiles the opened `.pgf` file with `pdflatex` into a PDF (in a temporary directory).
- Attempts to rasterize the generated PDF to a PNG (using `pdftocairo`, `pdftoppm`, or ImageMagick `convert`).
- Opens the resulting PNG with VS Code's built-in image preview (so you get zoom/pan/fit features).

If rasterization fails the extension will offer a link to open the generated PDF externally.

Requirements

- `pdflatex` (from a TeX distribution such as TeX Live or MikTeX)
- One of: `pdftocairo`, `pdftoppm`, or ImageMagick's `convert` (for rasterizing PDF→PNG)

Usage

- Open a `.pgf` file in the Explorer or editor.
- Run the command **View PGF Image** from the Command Palette or use the custom editor (the extension registers a custom editor for `.pgf` files).

Developer / Contributing

- Build: `pnpm run compile`
- Watch: `pnpm run watch`
- Run the extension in the Extension Development Host from VS Code to test.

Notes

- The extension copies the source file into a temporary directory before compiling so relative image paths resolve correctly.
- Temporary files are created under the OS temp directory; they are not removed automatically so you can inspect outputs if needed.

License

MIT
