import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JPEG, PNG, makeRecipe, quotaError, resetDb, usePassthroughReencoder } from './helpers';
import {
  IMPORT_MAX_BYTES,
  StorageError,
  commitImport,
  countAll,
  exportBackup,
  getImage,
  getRecipe,
  getShoppingList,
  listCollections,
  listRecipes,
  previewImport,
  putImage,
  saveCollection,
  saveRecipe,
  utf8ByteLength,
} from '../../src/storage';
import type { BackupFileV1, RecipeV1 } from '../../src/shared/types';

beforeEach(async () => {
  await resetDb();
  usePassthroughReencoder();
});
afterEach(() => vi.restoreAllMocks());

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

function backup(over: Partial<BackupFileV1> & Record<string, unknown> = {}): BackupFileV1 {
  return { format: 'recipe-pocket-backup', version: 1, recipes: [], collections: [], shoppingLists: [], ...over } as BackupFileV1;
}

async function invalid(text: string): Promise<string> {
  const err = await previewImport(text).then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(StorageError);
  expect((err as StorageError).code).toBe('INVALID_BACKUP');
  return (err as StorageError).message;
}

describe('exportBackup', () => {
  it('round-trips recipes, collections and images through export -> import', async () => {
    const img = await putImage(new Blob([PNG]));
    await saveCollection({ id: 'k', name: 'Dinner' });
    await saveRecipe(makeRecipe({ id: 'a', collectionIds: ['k'], localImageId: img.id }));
    const text = await exportBackup({ includeImages: true });
    const parsed = JSON.parse(text) as BackupFileV1;
    expect(parsed.format).toBe('recipe-pocket-backup');
    expect(parsed.version).toBe(1);
    expect(parsed.images?.[0]?.dataUrl).toBe(`data:image/png;base64,${b64(PNG)}`);
    expect(JSON.parse(await exportBackup()).images).toBeUndefined();

    await resetDb();
    usePassthroughReencoder();
    const preview = await previewImport(text);
    expect(preview).toMatchObject({ recipeCount: 1, collectionCount: 1, imageCount: 1, conflicts: [] });
    expect(await commitImport(preview, 'skip')).toEqual({ added: 1, replaced: 0, skipped: 0 });
    const a = await getRecipe('a');
    expect(a?.collectionIds).toEqual(['k']);
    const back = await getImage(a!.localImageId!);
    expect(new Uint8Array(await back!.blob.arrayBuffer())).toEqual(PNG);
  });
});

describe('previewImport validation', () => {
  it('accepts exactly 10 MB (UTF-8 bytes) and rejects one byte more', async () => {
    const base = JSON.stringify(backup({ recipes: [makeRecipe({ id: 'big', notes: '' })] }));
    // Pad with a 2-byte character to prove UTF-8 bytes (not string length) are measured.
    const padBytes = IMPORT_MAX_BYTES - utf8ByteLength(base);
    const pad = 'é'.repeat(Math.floor(padBytes / 2)) + 'a'.repeat(padBytes % 2);
    const exact = base.replace('"notes":""', `"notes":"${pad}"`);
    expect(utf8ByteLength(exact)).toBe(IMPORT_MAX_BYTES);
    expect(Buffer.byteLength(exact, 'utf8')).toBe(IMPORT_MAX_BYTES);
    expect(exact.length).toBeLessThan(IMPORT_MAX_BYTES);
    const ok = await previewImport(exact);
    expect(ok.recipeCount).toBe(1);

    const over = exact.replace('"notes":"', '"notes":"a');
    expect(Buffer.byteLength(over, 'utf8')).toBe(IMPORT_MAX_BYTES + 1);
    expect(await invalid(over)).toMatch(/10 MB/);
  }, 30_000);

  it('rejects invalid JSON and wrong format/version', async () => {
    expect(await invalid('{not json')).toMatch(/not valid JSON/);
    expect(await invalid('[]')).toMatch(/not a Recipe Pocket backup|JSON object/);
    expect(await invalid(JSON.stringify({ format: 'other', version: 1 }))).toMatch(/not a Recipe Pocket backup/);
    expect(await invalid(JSON.stringify({ format: 'recipe-pocket-backup', version: 99, recipes: [] }))).toMatch(/newer version/);
    expect(await invalid(JSON.stringify({ format: 'recipe-pocket-backup', version: '1', recipes: [] }))).toMatch(/version/);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects prototype-pollution key %s anywhere', async (key) => {
    const r = makeRecipe({ id: 'p' });
    const text = JSON.stringify(backup({ recipes: [r] })).replace('"times":{', `"times":{"${key}":{"polluted":true},`);
    expect(await invalid(text)).toMatch(/forbidden field/);
    // Escaped spelling is caught too (keys are checked after parsing).
    const escaped = JSON.stringify(backup()).replace('{', '{"__pro\\u0074o__":{"polluted":true},');
    expect(await invalid(escaped)).toMatch(/forbidden field/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects nesting deeper than 30 and accepts 30', async () => {
    const nest = (n: number) => '['.repeat(n) + ']'.repeat(n);
    // Root object is level 1; the "x" value adds levels.
    expect(await invalid(`{"format":"recipe-pocket-backup","version":1,"recipes":[],"x":${nest(30)}}`)).toMatch(/nested/);
    const ok = await previewImport(`{"format":"recipe-pocket-backup","version":1,"recipes":[],"x":${nest(29)}}`);
    expect(ok.warnings.join(' ')).toMatch(/unknown field/);
    // Pathologically deep input is rejected before JSON.parse.
    expect(await invalid(nest(100_000))).toMatch(/nested/);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html;base64,PHNjcmlwdD4='],
    ['file:', 'file:///etc/passwd'],
  ])('rejects %s source links', async (_n, url) => {
    const text = JSON.stringify(backup({ recipes: [makeRecipe({ source: { url } })] }));
    expect(await invalid(text)).toMatch(/recipes\[0\]\.source\.url must be an http or https link/);
  });

  it('rejects invalid shapes with a plain-text reason naming the field', async () => {
    const bad = { ...makeRecipe(), ingredientGroups: [{ id: 'g', title: '', items: 'oops' }] };
    expect(await invalid(JSON.stringify(backup({ recipes: [bad as unknown as RecipeV1] })))).toBe(
      'Invalid backup: recipes[0].ingredientGroups[0].items must be a list.',
    );
    expect(await invalid(JSON.stringify(backup({ recipes: 'x' as never })))).toMatch(/recipes must be a list/);
    const dup = makeRecipe({ id: 'same' });
    expect(await invalid(JSON.stringify(backup({ recipes: [dup, { ...dup }] })))).toMatch(/same recipe id/);
  });

  it('rejects SVG/HTML or mismatched images', async () => {
    const svg = `data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}`;
    expect(await invalid(JSON.stringify(backup({ images: [{ id: 'i', mime: 'image/png', dataUrl: svg }] })))).toMatch(/images\[0\]/);
    const svgMime = 'data:image/svg+xml;base64,PHN2Zy8+';
    expect(await invalid(JSON.stringify(backup({ images: [{ id: 'i', mime: 'image/png', dataUrl: svgMime }] })))).toMatch(/images\[0\]/);
    const mismatch = `data:image/png;base64,${b64(JPEG)}`;
    expect(await invalid(JSON.stringify(backup({ images: [{ id: 'i', mime: 'image/png', dataUrl: mismatch }] })))).toMatch(/images\[0\]/);
  });

  it('strips unknown fields and keeps XSS-looking text verbatim', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    const r = { ...makeRecipe({ id: 'x', title: xss }), evil: '<script>', revision: 3 };
    const preview = await previewImport(JSON.stringify({ ...backup({ recipes: [r as RecipeV1] }), extraTop: 1 }));
    expect(preview.backup.recipes[0]!.title).toBe(xss);
    expect('evil' in preview.backup.recipes[0]!).toBe(false);
    expect('extraTop' in preview.backup).toBe(false);
    expect(preview.warnings).toContain('Ignored 2 unknown field(s).');
    await commitImport(preview, 'skip');
    expect((await getRecipe('x'))?.title).toBe(xss);
  });

  it('previewImport writes nothing', async () => {
    await previewImport(JSON.stringify(backup({ recipes: [makeRecipe()], collections: [{ id: 'k', name: 'K' }] })));
    expect(await countAll()).toEqual({ recipes: 0, collections: 0, shoppingLists: 0, images: 0 });
  });
});

describe('legacy (version 0) migration', () => {
  const legacy = {
    format: 'recipe-pocket-backup',
    version: 0,
    recipes: [
      {
        id: 'old-1',
        name: 'Grandma soup',
        url: 'https://example.com/soup?utm_source=mail',
        ingredients: ['2 carrots', 'salt to taste'],
        steps: ['Chop.', 'Simmer.'],
        tags: ['soup'],
        notes: 'Family recipe',
        collections: ['c1'],
      },
    ],
    collections: [{ id: 'c1', name: 'Winter' }],
  };

  it('migrates to version 1 and imports', async () => {
    const preview = await previewImport(JSON.stringify(legacy));
    expect(preview.warnings).toContain('Converted a version 0 backup to version 1.');
    const r = preview.backup.recipes[0]!;
    expect(r).toMatchObject({
      schemaVersion: 1,
      id: 'old-1',
      title: 'Grandma soup',
      source: { url: 'https://example.com/soup' },
      notes: 'Family recipe',
      tags: ['soup'],
      collectionIds: ['c1'],
      extraction: { method: 'manual', missingFields: [] },
    });
    expect(r.ingredientGroups[0]!.items.map((i) => i.raw)).toEqual(['2 carrots', 'salt to taste']);
    expect(r.instructionGroups[0]!.steps.map((s) => s.text)).toEqual(['Chop.', 'Simmer.']);
    await commitImport(preview, 'skip');
    expect((await listCollections()).map((c) => c.name)).toEqual(['Winter']);
    expect((await getRecipe('old-1'))?.revision).toBe(1);
  });

  it('a failing migration (bad legacy shape) is rejected and writes nothing', async () => {
    await saveRecipe(makeRecipe({ id: 'keep' }));
    const bad = { ...legacy, recipes: [{ ...legacy.recipes[0], ingredients: 'not a list' }] };
    expect(await invalid(JSON.stringify(bad))).toMatch(/ingredients must be a list/);
    const badUrl = { ...legacy, recipes: [{ ...legacy.recipes[0], url: 'javascript:alert(1)' }] };
    expect(await invalid(JSON.stringify(badUrl))).toMatch(/http or https/);
    expect((await listRecipes()).map((r) => r.id)).toEqual(['keep']);
  });
});

describe('conflicts and commitImport', () => {
  async function seed() {
    await saveCollection({ id: 'k', name: 'Dinner' });
    const a = await saveRecipe(makeRecipe({ id: 'a', title: 'Local A', source: { url: 'https://example.com/a' }, collectionIds: ['k'] }));
    const b = await saveRecipe(makeRecipe({ id: 'b', title: 'Local B', source: { url: 'https://example.com/b' } }));
    return { a, b };
  }
  const incoming = () =>
    backup({
      recipes: [
        makeRecipe({ id: 'a', title: 'Incoming A', source: { url: 'https://example.com/a' }, collectionIds: ['k'] }),
        makeRecipe({ id: 'z', title: 'Incoming B copy', source: { url: 'https://example.com/b?utm_medium=x#c' } }),
        makeRecipe({ id: 'n', title: 'New', source: { url: 'https://example.com/n' }, collectionIds: ['k'] }),
      ],
      collections: [{ id: 'k', name: 'Supper' }],
      shoppingLists: [
        {
          id: 'L',
          name: 'List',
          aisles: [],
          items: [{ id: 'x', text: 'carrot', aisle: 'Produce', checked: false, manual: false, sources: [{ recipeId: 'a', recipeTitle: 'Incoming A', raw: 'carrot' }] }],
          revision: 7,
        },
      ],
    });

  it('detects conflicts by id and by normalized source URL', async () => {
    await seed();
    const p = await previewImport(JSON.stringify(incoming()));
    expect(p.conflicts).toEqual([
      { incomingId: 'a', existingId: 'a', title: 'Incoming A', reason: 'id' },
      { incomingId: 'z', existingId: 'b', title: 'Incoming B copy', reason: 'source' },
    ]);
  });

  it("'skip' (default) never overwrites", async () => {
    const { a, b } = await seed();
    const p = await previewImport(JSON.stringify(incoming()));
    expect(await commitImport(p, 'skip')).toEqual({ added: 1, replaced: 0, skipped: 2 });
    expect(await getRecipe('a')).toEqual(a);
    expect(await getRecipe('b')).toEqual(b);
    expect(await getRecipe('z')).toBeUndefined();
    expect((await listCollections())).toEqual([{ id: 'k', name: 'Dinner' }]);
    // Shopping list source remapped to the equivalent local recipe.
    expect((await getShoppingList('L'))?.items[0]?.sources[0]?.recipeId).toBe('a');
  });

  it('importing the same backup twice adds nothing the second time', async () => {
    const text = JSON.stringify(incoming());
    expect(await commitImport(await previewImport(text), 'skip')).toEqual({ added: 3, replaced: 0, skipped: 0 });
    const before = await exportBackup();
    const second = await previewImport(text);
    expect(second.conflicts).toHaveLength(3);
    expect(await commitImport(second, 'skip')).toEqual({ added: 0, replaced: 0, skipped: 3 });
    expect(await exportBackup()).toBe(before);
  });

  it("'replace' overwrites in place, keeping local ids and bumping revision", async () => {
    const { a, b } = await seed();
    const p = await previewImport(JSON.stringify(incoming()));
    expect(await commitImport(p, 'replace')).toEqual({ added: 1, replaced: 2, skipped: 0 });
    expect(await getRecipe('a')).toMatchObject({ title: 'Incoming A', revision: a.revision + 1 });
    expect(await getRecipe('b')).toMatchObject({ title: 'Incoming B copy', revision: b.revision + 1 });
    expect(await getRecipe('z')).toBeUndefined();
    expect(await listCollections()).toEqual([{ id: 'k', name: 'Supper' }]);
  });

  it("'duplicate' assigns new ids and remaps collection, image and list references", async () => {
    await seed();
    const localImg = await putImage(new Blob([PNG]));
    const data = incoming();
    data.recipes[0]!.localImageId = localImg.id; // same id as a local image -> must be duplicated
    data.images = [{ id: localImg.id, mime: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${b64(JPEG)}` }];
    const p = await previewImport(JSON.stringify(data));
    expect(await commitImport(p, 'duplicate')).toEqual({ added: 3, replaced: 0, skipped: 0 });

    const all = await listRecipes();
    expect(all).toHaveLength(5);
    const dupA = all.find((r) => r.title === 'Incoming A')!;
    expect(dupA.id).not.toBe('a');
    expect((await getRecipe('a'))?.title).toBe('Local A');
    expect(await getRecipe('z')).toMatchObject({ title: 'Incoming B copy' }); // source conflict keeps its own id

    // Collection 'k' differs by name -> duplicated under a new id; recipes point at the copy.
    const cols = await listCollections();
    expect(cols).toHaveLength(2);
    const supper = cols.find((c) => c.name === 'Supper')!;
    expect(supper.id).not.toBe('k');
    expect(dupA.collectionIds).toEqual([supper.id]);
    expect((await getRecipe('n'))?.collectionIds).toEqual([supper.id]);
    expect((await getRecipe('a'))?.collectionIds).toEqual(['k']);

    // Image id collided -> copied under a new id; the local image is untouched.
    expect(dupA.localImageId).toBeDefined();
    expect(dupA.localImageId).not.toBe(localImg.id);
    expect((await getImage(dupA.localImageId!))?.mime).toBe('image/jpeg');
    expect((await getImage(localImg.id))?.mime).toBe('image/png');

    // Shopping list sources follow the new recipe id.
    expect((await getShoppingList('L'))?.items[0]?.sources[0]?.recipeId).toBe(dupA.id);
  });

  it('is atomic: a quota failure mid-import leaves existing data intact', async () => {
    await seed();
    const before = await exportBackup({ includeImages: true });
    let calls = 0;
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      calls++;
      if (calls === 3) throw quotaError();
      return realPut.apply(this, args);
    });
    const p = await previewImport(JSON.stringify(incoming()));
    const err = await commitImport(p, 'replace').then(() => null, (e: unknown) => e);
    expect((err as StorageError).code).toBe('QUOTA');
    expect(calls).toBeGreaterThanOrEqual(3);
    vi.restoreAllMocks();
    expect(await exportBackup({ includeImages: true })).toBe(before);
  });

  it('re-validates a tampered preview before writing', async () => {
    const p = await previewImport(JSON.stringify(incoming()));
    (p.backup.recipes[0] as { source: { url: string } }).source.url = 'javascript:alert(1)';
    const err = await commitImport(p, 'skip').then(() => null, (e: unknown) => e);
    expect((err as StorageError).code).toBe('INVALID_BACKUP');
    expect((await countAll()).recipes).toBe(0);
  });
});
