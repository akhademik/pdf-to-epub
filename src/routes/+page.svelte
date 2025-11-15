<script lang="ts">
  let pdfFile: File | null = null;
  let conversionStatus: string = '';
  let epubDownloadLink: string = '';
  let toc = '';
  let pageCorrection = '5=10';

  async function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      pdfFile = target.files[0];
      conversionStatus = `Selected file: ${pdfFile.name}`;
      epubDownloadLink = ''; // Clear previous download link
    }
  }

  async function convertPdfToEpub() {
    if (!pdfFile) {
      conversionStatus = 'Please select a PDF file first.';
      return;
    }

    conversionStatus = 'Uploading and converting...';
    epubDownloadLink = '';

    const formData = new FormData();
    formData.append('pdf', pdfFile);
    formData.append('toc', toc);
    formData.append('pageCorrection', pageCorrection);

    try {
      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });

      if (response.ok && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              conversionStatus = line.substring(6);
            } else if (line.startsWith('epub:')) {
              const base64Epub = line.substring(5);
              const byteCharacters = atob(base64Epub);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: 'application/epub+zip' });
              const url = URL.createObjectURL(blob);
              epubDownloadLink = url;
              conversionStatus = 'Conversion successful! Click to download.';
            }
          }
        }
      } else {
        const errorText = await response.text();
        conversionStatus = `Conversion failed: ${errorText}`;
      }
    } catch (error) {
      console.error('Error during conversion:', error);
      conversionStatus = 'An error occurred during conversion.';
    }
  }
</script>

<div class="font-sans m-8">
  <h1 class="text-2xl font-bold mb-4">PDF to EPUB Converter</h1>

  <div class="mb-4">
    <label for="pdf-upload" class="block mb-2">Upload PDF:</label>
    <input id="pdf-upload" type="file" accept="application/pdf" on:change={handleFileUpload} class="mb-4" />
  </div>

  <div class="mb-4">
    <label for="toc" class="block mb-2">Table of Contents:</label>
    <textarea id="toc" bind:value={toc} rows="10" class="border p-2 w-full" placeholder="Chapter 1: 1-20&#10;Chapter 2: 21-45"></textarea>
  </div>

  <div class="mb-4">
    <label for="page-correction" class="block mb-2">Page Correction:</label>
    <input id="page-correction" type="text" bind:value={pageCorrection} class="border p-2" placeholder="e.g., 5=10">
    <p class="text-sm text-gray-600">Format: book_page=pdf_page</p>
  </div>

  <button
    on:click={convertPdfToEpub}
    disabled={!pdfFile}
    class="px-4 py-2 bg-blue-500 text-white rounded-md cursor-pointer disabled:bg-gray-400 disabled:cursor-not-allowed"
  >
    Convert to EPUB
  </button>

  {#if conversionStatus}
    <p class="mt-4">{conversionStatus}</p>
  {/if}

  {#if epubDownloadLink}
    <a
      href={epubDownloadLink}
      download="converted.epub"
      class="inline-block mt-4 px-4 py-2 bg-green-500 text-white no-underline rounded-md"
    >
      Download EPUB
    </a>
  {/if}
</div>
