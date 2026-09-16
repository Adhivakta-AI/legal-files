ALTER TABLE legal_documents ADD COLUMN pdf_key TEXT;

UPDATE legal_documents
SET pdf_key = 'legal-sources/bns-2023/source.pdf'
WHERE id = 'bns-2023';

UPDATE legal_documents
SET pdf_key = 'legal-sources/bnss-2023/source.pdf'
WHERE id = 'bnss-2023';

UPDATE legal_documents
SET pdf_key = 'legal-sources/constitution-of-india/source.pdf'
WHERE id = 'constitution-of-india';
