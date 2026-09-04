# Mititoys coleccionables

Tienda online de figuras de anime con Mercado Pago Checkout Pro.

## Sistema de pedidos

La tienda incorpora:
- Pedidos persistentes en PostgreSQL.
- Registro de clientes por email.
- Estados de pedido y de pago.
- Historial de eventos del pedido.
- Webhook de Mercado Pago que actualiza automáticamente el estado.
- Página pública de seguimiento en `/pedido.html?pedido=...`.
- Panel privado de administración en `/admin.html`.
- Cotización profesional de envíos por provincia y código postal mediante Envíopack.
- Selección de correo, costo y plazo estimado antes de ingresar a Mercado Pago.
- Validación del precio del envío en el servidor y cotizaciones con vencimiento.

## Configuración de producción

Variables de entorno requeridas en Vercel:

- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`
- `DATABASE_URL`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

Para habilitar las cotizaciones automáticas de envío también se requieren:

- `ENVIOPACK_API_KEY`
- `ENVIOPACK_SECRET_KEY`
- `ENVIOPACK_DEPOSIT_ID` (opcional si la cuenta de Envíopack tiene un depósito predeterminado)

`MERCADOPAGO_ACCESS_TOKEN` y `MERCADOPAGO_WEBHOOK_SECRET` deben permanecer privadas.

## Base de datos

1. Crear una base PostgreSQL (Neon es adecuada para funciones serverless).
2. Copiar el contenido de `database/schema.sql` en el SQL Editor de la base y ejecutarlo.
3. Copiar la cadena de conexión de PostgreSQL en Vercel como `DATABASE_URL`.
4. Crear `ADMIN_PASSWORD` con una contraseña fuerte.
5. Crear `ADMIN_SESSION_SECRET` con una cadena aleatoria larga.
6. Hacer un nuevo deploy en Vercel.

## Panel

Abrir `/admin.html`, ingresar `ADMIN_PASSWORD` y administrar pedidos, estados, tracking y clientes.

Abrir `/admin-envios.html` para cargar el peso y las medidas de cada figura ya embalada. Todos los productos del carrito deben tener estos cuatro datos para obtener una cotización real.

## Envíopack

1. Crear o vincular una cuenta de Envíopack.
2. Configurar un depósito predeterminado en la cuenta, o cargar su ID como `ENVIOPACK_DEPOSIT_ID`.
3. Cargar `ENVIOPACK_API_KEY` y `ENVIOPACK_SECRET_KEY` como secretos en Vercel.
4. Completar peso, largo, ancho y alto de todos los productos publicados desde `/admin-envios.html`.
5. Volver a desplegar. El checkout detecta automáticamente la configuración y habilita el cotizador.

## Mercado Pago

El Webhook productivo debe seguir apuntando a:
`https://otaku-collectibles.vercel.app/api/webhook-mercadopago`

Mantener seleccionado el evento de pagos que ya está funcionando.
