# Assets de la demo del hero

Deja aquí un `coat.png`, `bag.png` o `shoes.png` (o `.webp`/`.jpg`) y
`npm run demo:assets` lo usará en lugar de la URL documentada en
`scripts/prepareDemoAssets.ts`.

También sirve una variable de entorno, que además acepta URL:

```bash
DEMO_ASSET_COAT=/ruta/a/mi-abrigo.png npm run demo:assets
DEMO_ASSET_COAT=https://images.unsplash.com/photo-xxxx npm run demo:assets
```

El script valida MIME, tamaño y resolución, recorta el fondo si hace falta,
escribe el WebP optimizado en `public/demo/products/` y anota la procedencia en
`metadata.json`. Después hay que copiar el tamaño que imprime a `intrinsic` en
`lib/landing/heroDemo.ts`.

**Por qué existe esta carpeta:** el abrigo actual proviene de una miniatura de
Google Images sin licencia verificable y debe sustituirse antes de cualquier uso
comercial. Ver `docs/DEMO_ASSETS.md`.
