// src/lib/server/modules/pdf.ts
import fs from 'fs/promises';
import path from 'path';
import { pdf } from 'pdf-to-img';
import { CONFIG } from './config';

/**
 * Converts PDF to images
 */
export async function convertPdfToImages(
	pdfPath: string,
	outputDir: string,
	sendProgress: (msg: string) => void
): Promise<void> {
	await fs.mkdir(outputDir, { recursive: true });

	const existingImages = await fs.readdir(outputDir);
	if (existingImages.length > 0) {
		sendProgress('Images already extracted.');
		return;
	}

	sendProgress('Converting PDF to images...');
	const doc = await pdf(pdfPath, { scale: CONFIG.PDF_SCALE });
	let i = 1;
	for await (const image of doc) {
		sendProgress(`Extracting page ${i}...`);
		const imagePath = path.join(outputDir, `page-${i}.png`);
		await fs.writeFile(imagePath, image);
		i++;
	}
}
