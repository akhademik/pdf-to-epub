// src/lib/server/modules/config.ts
export const VIETNAMESE_CHARACTERS =
	'a-zA-Zàáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ';

export const CONFIG = {
	PDF_SCALE: 1.5,
	OCR_LANGUAGE: 'vie',
	MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
	TEMP_DIR: './tmp',
	LANG_PATH: '.',
	MAX_OCR_RETRIES: 3,
	OCR_RETRY_DELAY: 1000
} as const;
