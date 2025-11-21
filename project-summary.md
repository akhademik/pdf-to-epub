# Project Summary: PDF to EPUB Converter

This is a SvelteKit web application that converts PDF files to EPUB format.

## Core Functionality

The application allows users to upload a PDF file, provide a custom table of contents (TOC), and specify a page number correction to handle discrepancies between the book's page numbers and the PDF's page numbers. The backend then processes the PDF, extracts the text using Optical Character Recognition (OCR), and generates an EPUB file.

## Project Structure

- **Frontend**: Built with SvelteKit. The main user interface is in `src/routes/+page.svelte`.
- **Backend**: A Hono server running on Node.js. The backend logic is located in `src/lib/server/index.ts` and is broken down into smaller modules in the `src/lib/server/modules` directory. The server is exposed via server-side hooks in `src/hooks.server.ts`. Configuration is stored in `src/lib/server/modules/config.ts`.
- **Styling**: Tailwind CSS.
- **Package Manager**: pnpm.

## Detailed Workflow

1.  **User Interface (`src/routes/+page.svelte`)**:
    - A user uploads a PDF file.
    - The user can optionally provide a table of contents in the format `Chapter Title: start_page-end_page`.
    - The user can optionally provide a page correction in the format `book_page=pdf_page`.
    - On clicking "Convert", the frontend sends a `POST` request to `/api/convert` with the PDF, TOC, and page correction as `FormData`.
    - The frontend then listens for Server-Sent Events (SSE) to receive real-time progress updates from the backend.
    - When the conversion is complete, the backend sends a download link, which is then displayed to the user.

2.  **Backend (`src/lib/server/index.ts`)**:
    - The Hono server is integrated with SvelteKit via `src/hooks.server.ts`, which forwards all requests starting with `/api` to the Hono application.
    - **`/api/convert` (POST)**:
      - Receives the uploaded file and data.
      - Validates the input.
      - **Updated:** Creates a temporary directory for processing named after the sanitized book title and an 8-digit hash of the original PDF filename (e.g., `Book_Title-a1b2c3d4`).
      - Saves the uploaded PDF to the temporary directory.
      - Uses the `pdf-to-img` library to convert each page of the PDF into a PNG image.
      - Uses `tesseract.js` to perform OCR on each image to extract the text content. The original OCR output is saved to an `ocr_original` subdirectory.
      - Applies a series of text corrections using a predefined dictionary (`replace-dict.json`) to fix common OCR errors. The corrected output is saved to an `ocr_corrected` subdirectory, preserving the original OCR output for comparison.
      - Uses `jszip` to construct an EPUB file from the extracted and corrected text (from `ocr_corrected`, or `ocr_original` if no corrections were applied), following the structure defined by the user's TOC. The EPUB is styled with a custom CSS file (`epub-style.css`) and uses the first page of the PDF as the cover image.
      - If no TOC is provided, it treats the entire book as a single chapter. It also automatically adds "Introduction" and "Appendices" sections for pages not covered by the user's TOC.
      - Saves the generated `.epub` file to the temporary directory.
      - Identifies and logs "abnormal" words (words not found in `viet-dict.txt` or `ignore-dict.json`) to a separate file for later review.
      - Streams progress updates back to the client using SSE.
      - Finally, it sends a message with the unique download URL for the generated file, now using the new temporary directory name in the URL.
    - **`/api/download/:dir/:filename` (GET)**:
      - **Updated:** Serves the generated EPUB file from the temporary directory. The URL now includes the temporary directory name (`:dir`) and the filename. A security check is implemented to prevent path traversal.

## Key Dependencies

- **SvelteKit**: Web framework.
- **Hono**: Backend API framework.
- **Tesseract.js**: OCR library.
- **pdf-to-img**: Library for converting PDF pages to images.
- **JSZip**: Library for creating ZIP archives (which is the underlying format of EPUB).
- **Tailwind CSS**: For styling.
