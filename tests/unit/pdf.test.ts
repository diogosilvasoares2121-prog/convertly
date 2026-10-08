import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { assemblePdf, imagesToPdf, inspectPdf, mergePdfs, splitPdf, writePdfMetadata } from '../../src/engines/pdf/ops';
import { AppError } from '../../src/core/errors';
import { fixture } from './helpers';

const pages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

describe('PDF engine (pdf-lib)', () => {
  it('merges two PDFs (3 + 2 = 5 pages)', async () => {
    const merged = await mergePdfs([fixture('sample.pdf'), fixture('sample2.pdf')]);
    expect(await pages(merged)).toBe(5);
  });

  it('splits a 10-page PDF into ranges 1-3', async () => {
    const [part] = await splitPdf(fixture('sample10.pdf'), [[0, 1, 2]]);
    expect(await pages(part!)).toBe(3);
  });

  it('splits every page', async () => {
    const parts = await splitPdf(fixture('sample.pdf'), [[0], [1], [2]]);
    expect(parts).toHaveLength(3);
  });

  it('assembles: reorder, rotate, duplicate and delete', async () => {
    const out = await assemblePdf([fixture('sample.pdf')], [
      { src: 0, index: 2, rotate: 90 },
      { src: 0, index: 0 },
      { src: 0, index: 0, rotate: 180 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(0);
    expect(doc.getPage(2).getRotation().angle).toBe(180);
  });

  it('rejects pages that do not exist', async () => {
    await expect(assemblePdf([fixture('sample.pdf')], [{ src: 0, index: 7 }])).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('reads and removes metadata', async () => {
    const info = await inspectPdf(fixture('sample.pdf'));
    expect(info.pageCount).toBe(3);
    expect(info.metadata.title).toBe('Convertly Sample A');
    expect(info.metadata.author).toBe('Convertly fixtures');
    const clean = await writePdfMetadata(fixture('sample.pdf'), {}, true);
    const after = await inspectPdf(clean);
    expect(after.metadata.title).toBe('');
    expect(after.metadata.author).toBe('');
    expect(after.pageCount).toBe(3);
  });

  it('edits metadata', async () => {
    const out = await writePdfMetadata(fixture('sample.pdf'), { title: 'Novo título', author: 'Ana' }, false);
    const info = await inspectPdf(out);
    expect(info.metadata.title).toBe('Novo título');
    expect(info.metadata.author).toBe('Ana');
  });

  it('detects password-protected PDFs', async () => {
    await expect(inspectPdf(fixture('sample-encrypted.pdf'))).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === 'pdf-encrypted');
  });

  it('reports corrupted and empty PDFs clearly', async () => {
    await expect(inspectPdf(fixture('corrupt.pdf'))).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === 'corrupted-file');
    await expect(inspectPdf(fixture('empty.pdf'))).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === 'empty-file');
  });

  it('creates a PDF from JPG and PNG images', async () => {
    const out = await imagesToPdf(
      [
        { bytes: fixture('sample.jpg'), type: 'jpg' },
        { bytes: fixture('sample.png'), type: 'png' },
      ],
      { pageSize: 'a4', orientation: 'auto', margin: 'small', fit: 'contain' },
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    // landscape image on A4 with orientation "auto" → landscape page
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
  });
});
