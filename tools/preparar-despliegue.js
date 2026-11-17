// Copia el front actual (index.html y admin.html) al paquete deploy/public_html para subirlo a Hostgator.
// Uso:  node tools/preparar-despliegue.js
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const destino = path.join(raiz, 'deploy', 'public_html');

fs.mkdirSync(path.join(destino, 'admin'), { recursive: true });
fs.copyFileSync(path.join(raiz, 'index.html'), path.join(destino, 'index.html'));
fs.copyFileSync(path.join(raiz, 'admin.html'), path.join(destino, 'admin', 'index.html'));

// Aviso si por error hay secretos dentro del paquete
const prohibido = ['config.php', 'admin.config.json'];
const sobran = prohibido.filter(f => fs.existsSync(path.join(destino, f)) || fs.existsSync(path.join(destino, 'api', f)));
if (sobran.length) { console.error('¡Quita del paquete antes de subir:', sobran.join(', ')); process.exit(1); }

console.log('Paquete listo en', destino);
console.log('  index.html, admin/index.html, api/, .htaccess');
console.log('Siguiente: crea api/config.php en el servidor (copia de api/config.sample.php) y sube TODO el contenido de public_html.');
