// Genera deploy/mysql/02_productos.sql con los productos (y anuncios) que hoy sirve tu Node + SQL Server.
// Uso (con el servidor encendido):   node tools/exportar-mysql.js
const fs = require('fs');
const path = require('path');

const q = v => v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";

(async () => {
  const resp = await fetch('http://localhost:3000/api/productos');
  if (!resp.ok) throw new Error('El servidor Node no responde en :3000 (¿está encendido?)');
  const productos = await resp.json();
  if (productos.length !== 500) console.warn(`Aviso: se esperaban 500 productos y llegaron ${productos.length}.`);

  const filas = productos.map(p =>
    `(${p.idDb}, ${q(p.t)}, ${q(p.c)}, ${q(p.m)}, ${Number(p.p).toFixed(2)}, ${q(p.f.join(' | '))}, ${q(p.colores.join(', '))}, ${q(p.img)})`);

  let sql = '-- Productos exportados desde SQL Server (MegaStoreDB). Importar DESPUÉS de 01_esquema.sql.\nSET NAMES utf8mb4;\n';
  for (let i = 0; i < filas.length; i += 100) {
    sql += 'INSERT INTO Productos (Id, Titulo, Categoria, Marca, Precio, Caracteristicas, Colores, Imagen) VALUES\n' + filas.slice(i, i + 100).join(',\n') + ';\n';
  }

  sql += `
-- Anuncios de ejemplo (banners y productos patrocinados). Edítalos en phpMyAdmin.
INSERT INTO Anuncios (Tipo, Titulo, Texto, Boton, Categoria, Tema, Orden) VALUES
('banner', 'Envío GRATIS hasta 500 km', 'Escribe tu código postal al pagar y calculamos tu envío al instante.', NULL, NULL, 'verde', 1),
('banner', 'Tu sala en 4K', 'Descubre nuestra selección de televisores Smart TV.', 'Ver televisores', 'Televisores', 'azul', 2),
('banner', 'Música sin límites', 'Audífonos y bocinas con cancelación de ruido y Bluetooth 5.3.', 'Ver audio', 'Audio', 'morado', 3),
('banner', 'Rinde más con tu próxima laptop', 'Procesadores de última generación y SSD ultrarrápido.', 'Ver cómputo', 'Cómputo', 'naranja', 4);
INSERT INTO Anuncios (Tipo, ProductoId, Orden) VALUES ('producto', 1, 5), ('producto', 8, 6), ('producto', 11, 7), ('producto', 16, 8);
`;

  const destino = path.join(__dirname, '..', 'deploy', 'mysql', '02_productos.sql');
  fs.writeFileSync(destino, sql, 'utf8');
  console.log(`Listo: ${productos.length} productos -> ${destino}`);
})().catch(e => { console.error(e.message); process.exit(1); });
