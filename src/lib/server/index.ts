// src/lib/server/index.ts
import { Hono } from 'hono';
import { pdf } from 'pdf-to-img';
import { createWorker } from 'tesseract.js';
import JSZip from 'jszip';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const app = new Hono();

function sanitizeXml(text: string): string {
  return text.replace(/[&<"']/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return "&apos;";
      default:
        return match;
    }
  });
}

app.get('/api', (c) => {
  return c.text('Hono server is running!');
});

app.post('/api/convert', async (c) => {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendProgress = (message: string) => {
    writer.write(encoder.encode(`data: ${message}\n\n`));
  };

  const processPdf = async () => {
    let tempDir = '';
    try {
      const formData = await c.req.formData();
      const pdfFile = formData.get('pdf');
      const tocRaw = formData.get('toc');
      const pageCorrectionRaw = formData.get('pageCorrection');

      if (!pdfFile || !(pdfFile instanceof File)) {
        sendProgress('No PDF file uploaded.');
        writer.close();
        return;
      }
      
      if (!tocRaw) {
        sendProgress('No Table of Contents provided.');
        writer.close();
        return;
      }

      if (!pageCorrectionRaw) {
        sendProgress('No page correction provided.');
        writer.close();
        return;
      }

      // Parse page correction
      const [bookPage, pdfPage] = (pageCorrectionRaw as string).split('=').map(Number);
      if (isNaN(bookPage) || isNaN(pdfPage)) {
        sendProgress('Invalid page correction format. Please use book_page=pdf_page.');
        writer.close();
        return;
      }
      const pageOffset = pdfPage - bookPage;

      // Parse TOC
      const tocLines = (tocRaw as string).split('\n');
      const userChapters = tocLines.map(line => {
        const [title, pages] = line.split(':');
        return { title: title.trim(), pages: pages.trim() };
      });

      // Create a unique directory based on the file name
      const hash = crypto.createHash('md5').update(pdfFile.name).digest('hex');
      tempDir = path.join('./.tmp', `pdf-to-epub-${hash}`);
      await fs.mkdir(tempDir, { recursive: true });

      const pdfPath = path.join(tempDir, pdfFile.name);
      
      // Check if PDF exists, if not, write it
      try {
        await fs.access(pdfPath);
        sendProgress('PDF already exists, skipping upload.');
      } catch {
        sendProgress('Uploading PDF...');
        await fs.writeFile(pdfPath, Buffer.from(await pdfFile.arrayBuffer()));
      }

      // 2. Convert PDF to images
      const imageOutputDir = path.join(tempDir, 'images');
      await fs.mkdir(imageOutputDir, { recursive: true });
      
      const existingImages = await fs.readdir(imageOutputDir);
      if (existingImages.length === 0) {
        sendProgress('Converting PDF to images...');
        const doc = await pdf(pdfPath, { scale: 1.5 });
        let i = 1;
        for await (const image of doc) {
          sendProgress(`Extracting page ${i}...`);
          const imagePath = path.join(imageOutputDir, `page-${i}.png`);
          await fs.writeFile(imagePath, image);
          i++;
        }
      } else {
        sendProgress('Images already extracted.');
      }
      
      const imageFiles = await fs.readdir(imageOutputDir);

      // 3. Perform OCR on images
      const ocrOutputDir = path.join(tempDir, 'ocr');
      await fs.mkdir(ocrOutputDir, { recursive: true });
      
      sendProgress('Performing OCR on images...');
      const worker = await createWorker('vie', { langPath: '.' });
      
      for (let i = 0; i < imageFiles.length; i++) {
        const imageFile = `page-${i + 1}.png`;
        const imagePath = path.join(imageOutputDir, imageFile);
        const ocrPath = path.join(ocrOutputDir, `page-${i + 1}.txt`);

        try {
          await fs.access(ocrPath);
          sendProgress(`OCR for page ${i + 1} already exists.`);
        } catch {
          sendProgress(`OCR on page ${i + 1}/${imageFiles.length}...`);
          const { data: { text } } = await worker.recognize(imagePath);
          await fs.writeFile(ocrPath, text);
        }
      }
      await worker.terminate();

      // 4. Generate EPUB manually
      sendProgress('Generating EPUB...');
      const zip = new JSZip();
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

      const metaInf = zip.folder('META-INF');
      if (!metaInf) throw new Error('Failed to create META-INF folder');
      metaInf.file('container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

      const oebps = zip.folder('OEBPS');
      if (!oebps) throw new Error('Failed to create OEBPS folder');
      const chaptersFolder = oebps.folder('chapters');
      if (!chaptersFolder) throw new Error('Failed to create chapters folder');

      // --- New Chapter Logic ---
      const ocrFiles = await fs.readdir(ocrOutputDir);
      const totalPdfPages = ocrFiles.length;
      const bookEndPage = totalPdfPages - pageOffset;

      // Sort user chapters by start page
      userChapters.sort((a, b) => {
        const startA = parseInt(a.pages.split('-')[0], 10);
        const startB = parseInt(b.pages.split('-')[0], 10);
        return startA - startB;
      });

      const finalChapters: { title: string, pages: string }[] = [];
      const firstChapterStartBookPage = parseInt(userChapters[0].pages.split('-')[0], 10);
      const lastChapterEndBookPage = parseInt(userChapters[userChapters.length - 1].pages.split('-')[1], 10);
      const bookStartPage = 1 - pageOffset;

      // Add a preface if user chapters don't start from the beginning
      if (firstChapterStartBookPage > bookStartPage) {
        finalChapters.push({
          title: 'Introduction',
          pages: `${bookStartPage}-${firstChapterStartBookPage - 1}`
        });
      }

      // Add all user-defined chapters
      finalChapters.push(...userChapters);

      // Add an appendix if user chapters don't go to the very end
      if (lastChapterEndBookPage < bookEndPage) {
        finalChapters.push({
          title: 'Appendices',
          pages: `${lastChapterEndBookPage + 1}-${bookEndPage}`
        });
      }
      // --- End New Chapter Logic ---


      let opfManifest = '';
      let opfSpine = '';
      let tocNcx = '';
      let playOrder = 1;

      for (const chapter of finalChapters) {
        const [start, end] = chapter.pages.split('-').map(Number);
        if (isNaN(start) || isNaN(end)) continue;

        let chapterContent = '';
        for (let j = start; j <= end; j++) {
          const imageIndex = j + pageOffset;
          if (imageIndex < 1 || imageIndex > totalPdfPages) continue; // Skip pages outside the PDF range
          
          const ocrPath = path.join(ocrOutputDir, `page-${imageIndex}.txt`);
          try {
            const text = await fs.readFile(ocrPath, 'utf-8');
            chapterContent += sanitizeXml(text).replace(/\n/g, '<br/>');
          } catch {
            // ignore missing pages
          }
        }

        if (chapterContent.trim() === '') continue; // Skip empty chapters

        const chapterFileName = `chapter-${playOrder}.html`;
        chaptersFolder.file(chapterFileName, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${sanitizeXml(chapter.title)}</title>
</head>
<body>
  <h1>${sanitizeXml(chapter.title)}</h1>
  <p>${chapterContent}</p>
</body>
</html>`);

        opfManifest += `<item id="chapter-${playOrder}" href="chapters/${chapterFileName}" media-type="application/xhtml+xml"/>\n`;
        opfSpine += `<itemref idref="chapter-${playOrder}"/>\n`;
        tocNcx += `<navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
<navLabel><text>${sanitizeXml(chapter.title)}</text></navLabel>
<content src="chapters/${chapterFileName}"/>
</navPoint>\n`;
        playOrder++;
      }

      oebps.file('content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${sanitizeXml(pdfFile.name.replace('.pdf', ''))}</dc:title>
    <dc:creator opf:role="aut">pdf-to-epub</dc:creator>
    <dc:identifier id="book-id">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${opfManifest}
  </manifest>
  <spine toc="ncx">
    ${opfSpine}
  </spine>
</package>`);

      oebps.file('toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${crypto.randomUUID()}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${sanitizeXml(pdfFile.name.replace('.pdf', ''))}</text>
  </docTitle>
  <navMap>
    ${tocNcx}
  </navMap>
</ncx>`);

      const epubContent = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const epubFilename = `${pdfFile.name.replace('.pdf', '')}.epub`;
      const epubPath = path.join(tempDir, epubFilename);
      await fs.writeFile(epubPath, epubContent);
      
      const downloadUrl = `/api/download/${hash}/${epubFilename}`;
      sendProgress(`download:${downloadUrl}`);

    } catch (error) {
      console.error('Error during conversion:', error);
      sendProgress(`An error occurred during conversion: ${error}`);
    } finally {
      if (tempDir) {
        // Optional: cleanup the temporary directory
        // await fs.rm(tempDir, { recursive: true, force: true });
      }
      writer.close();
    }
  };

  processPdf();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

app.get('/api/download/:hash/:filename', async (c) => {
  const { hash, filename } = c.req.param();

  // Basic sanitization to prevent path traversal
  const safeFilename = path.basename(filename);

  const tempDir = path.join('./.tmp', `pdf-to-epub-${hash}`);
  const filePath = path.join(tempDir, safeFilename);

  try {
    await fs.access(filePath);
    const fileBuffer = await fs.readFile(filePath);
    
    return new Response(fileBuffer, {
      headers: {
        'Content-Type': 'application/epub+zip',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
      },
    });
  } catch (error) {
    return c.text('File not found or access denied.', 404);
  }
});



export type AppType = typeof app;

export default app;