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

## Configuración de producción

Variables de entorno requeridas en Vercel:

- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`
- `DATABASE_URL`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

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

## Mercado Pago

El Webhook productivo debe seguir apuntando a:
`https://otaku-collectibles.vercel.app/api/webhook-mercadopago`

Mantener seleccionado el evento de pagos que ya está funcionando.
