# DibujoVivo 3D

Lienzo 3D colaborativo en tiempo real: Node.js + Express + Socket.IO + Three.js.

## Inicio en Windows

1. Instala **Node.js 22 o superior** (incluye npm).
2. Ejecuta `install.bat` una vez. Requiere Internet para descargar las dependencias.
3. Ejecuta `run.bat`.
4. Abre **http://localhost:3000**. Mantén la ventana del servidor abierta.

No hay compilación del frontend ni dependencias descargadas desde CDN al abrir la aplicación.

## Salida visual / output3d

Abre **http://localhost:3000/output3d** (o `/output3d.html`) para mostrar únicamente el resultado visual. Es una página receptora: recibe los trazos por sockets y renderiza la misma escena sin paneles, textos, botones, ejes X/Y/Z ni interacción de dibujo o cámara. Ideal para una pantalla o proyector. Conserva el fondo generativo, el neón, los extremos cónicos y la vida de 10 segundos. Si se recarga o reconecta, recupera los trazos todavía vigentes.

## Compartir el contexto

Todas las pestañas y dispositivos que se conectan a **este mismo servidor** comparten un único lienzo. Cada persona conserva una cámara independiente; moverla no mueve las cámaras de las demás.

Para otros dispositivos en la misma red, usa `http://IP-DE-LA-PC:3000` en lugar de localhost. Puedes consultar tu IPv4 con `ipconfig`. Si Windows lo solicita, permite Node.js en **redes privadas**. No hace falta abrir puertos del router para usarlo en tu red local. Los dispositivos deben poder comunicarse entre sí; algunas redes de invitados aíslan los equipos.

Para colaborar por Internet hace falta desplegar el servidor en un alojamiento Node.js con HTTPS y soporte WebSocket, o configurar un acceso seguro. Esta versión es para una red de confianza: no incluye cuentas ni control de acceso y todos los participantes pueden limpiar el lienzo.

## Dibujar

- Arrastra sobre el lienzo en modo **Dibujar** para crear un trazo en 3D.
- **Computadora:** las cuatro flechas del teclado orbitan la cámara alrededor del lienzo, sin desplazar el centro ni cambiar el zoom. Funcionan en ambos modos; si estás dibujando, terminan el trazo antes de girar. Al enfocar un slider, las flechas ajustan ese control y no mueven la cámara.
- También puedes cambiar a **Orbitar** y arrastrar, usar el botón derecho o mantener Espacio. La rueda acerca o aleja.
- **Celular o tableta:** despliega las herramientas con `+`, elige **Orbitar** y arrastra con un dedo para girar la cámara. Dos dedos permiten rotación y zoom. Vuelve a **Dibujar** para trazar con un dedo; puedes plegar el panel con `−` para liberar el lienzo.
- El control de profundidad desplaza el plano de dibujo respecto del centro de la cámara; cada trazo mantiene el plano en el que comenzó.
- El slider de grosor cambia el ancho real en el espacio 3D.
- Elige los colores neón de la gama magenta, violeta y cian.
- **Deshacer** elimina tu último trazo terminado, no los de otras personas.
- **Limpiar** afecta a todos los usuarios y pide confirmación.

Cada trazo tiene extremos cónicos, vive **10 segundos desde su primer punto** y se desvanece gradualmente durante sus últimos **3 segundos**. El servidor comparte sus tiempos de nacimiento y vencimiento para que los usuarios vean la misma desaparición. Al reconectar se recibe el estado vigente; los trazos vencidos no vuelven.

El fondo negro contiene una malla 3D generativa animada. Su tiempo y semilla están compartidos, pero cada participante puede observarla desde su propio punto de vista.

## Archivos

- `server.js`: servidor principal, contexto compartido y vencimiento de trazos.
- `public/`: todo el frontend.
- `install.bat`: instalación de dependencias (usa `npm ci` cuando existe el lockfile).
- `run.bat`: ejecuta `server.js` desde la carpeta correcta.
- `tests/`: pruebas de servidor, frontend y lanzadores.

El lienzo es efímero: no se almacena en disco y un reinicio del servidor lo vacía.

## Comandos

```sh
npm install
npm start
npm test
```

Para las pruebas reales con Chromium (opcional):

```sh
npx playwright install chromium
npm run test:browser
```

Si el puerto 3000 está ocupado, desde CMD:

```bat
set PORT=3001
run.bat
```

La aplicación necesita un navegador con WebGL2 habilitado y aceleración gráfica. Si WebGL no está disponible muestra un aviso en lugar del lienzo.
