# PDF to EPUB Converter

This project is a web-based utility to convert PDF files into EPUB format. It uses OCR to extract text from the PDF pages and reconstructs the book based on a user-provided table of contents.

## Key Features

- **PDF to EPUB Conversion**: Upload any PDF and receive a downloadable EPUB file.
- **OCR Text Extraction**: Utilizes Tesseract.js to perform Optical Character Recognition on each page of the PDF.
- **Custom Table of Contents**: Define your own chapters and page ranges.
- **Page Number Correction**: A simple offset can be provided to map book page numbers to PDF page numbers.
- **Full Content Preservation**: Any pages not included in your custom table of contents are automatically grouped into "Introduction" and "Appendices" chapters, ensuring no content is lost.
- **Web-Based Interface**: Simple and easy-to-use interface built with SvelteKit.

## Tech Stack

- **Framework**: [SvelteKit](https://kit.svelte.dev/)
- **API Backend**: [Hono](https://hono.dev/) on Node.js
- **OCR**: [Tesseract.js](https://tesseract.projectnaptha.com/)
- **PDF Processing**: [pdf-to-img](https://www.npmjs.com/package/pdf-to-img)
- **EPUB Generation**: [JSZip](https://stuk.github.io/jszip/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)

## How It Works

1.  A user uploads a PDF file, a custom table of contents, and a page number correction value.
2.  The server saves the PDF and converts each page into a PNG image.
3.  Tesseract.js performs OCR on each image to extract the text content, which is saved to temporary files.
4.  The server then reads the text files and constructs an EPUB archive (`.epub`) based on the chapter ranges provided by the user.
5.  The generated EPUB is saved on the server, and a unique, secure download link is sent back to the user's browser.

## Prerequisites

This project relies on the `pdf-to-img` library, which requires a system-level dependency to function.

- **Linux/macOS**: You must have `poppler-utils` installed.
  - On Debian/Ubuntu: `sudo apt-get install poppler-utils`
  - On macOS (with Homebrew): `brew install poppler`

## Getting Started

1.  **Clone the repository:**

    ```sh
    git clone git@github.com:akhademik/pdf-to-epub.git
    cd pdf-to-epub
    ```

2.  **Install dependencies:**
    This project uses `pnpm`.

    ```sh
    pnpm install
    ```

3.  **Run the development server:**
    ```sh
    pnpm dev
    ```
    The application will be available at `http://localhost:5173`.

## Usage

1.  Open your browser and navigate to the local server address.
2.  Click the "Choose File" button to upload your PDF.
3.  **Fill in the Table of Contents**: In the large textarea, define your chapters, with each chapter on a new line. The format is `Chapter Title: start_page-end_page`.
    ```
    Chapter 1: The Beginning: 14-25
    Chapter 2: The Middle: 26-50
    ```
4.  **Set Page Correction**: In the "Page Correction" input, map a book page number to its corresponding PDF page number. The format is `book_page=pdf_page`. For example, if page 45 in the book is page 50 in your PDF reader, you would enter `45=50`.
5.  Click the "Convert" button.
6.  Wait for the processing to complete. A download link will appear when it's done.
