# 🚗 Auto Premium Service — CRM v2.0

Sistema de gestión de clientes y envío masivo por Email y WhatsApp.

---

## ✅ Requisitos

- **Node.js** v18 o superior → https://nodejs.org  
  *(Compatible con Node v25, sin necesidad de Python ni compiladores)*

---

## 🚀 Instalación (3 pasos)

Abre PowerShell o CMD dentro de la carpeta `autopremium-crm`:

```powershell
# 1. Instalar dependencias
npm install

# 2. Iniciar el servidor
npm start

# 3. Abrir en el navegador
http://localhost:3001
```

---

## ⚙️ Configurar Email (Gmail)

1. Entra a tu Google Account → **Seguridad → Verificación en 2 pasos** (actívala)
2. Busca **"Contraseñas de aplicación"** → crea una nueva → nombre: "Auto Premium"
3. Copia la contraseña de 16 caracteres

En el sistema ve a **Configuración** e ingresa:
| Campo | Valor |
|-------|-------|
| Servidor SMTP | `smtp.gmail.com` |
| Puerto | `587` |
| Correo remitente | `tucorreo@gmail.com` |
| Contraseña | la clave de 16 caracteres |

---

## 💬 Configurar WhatsApp (Twilio)

1. Regístrate gratis en https://twilio.com
2. Ve a **Messaging → Try it out → Send a WhatsApp message**
3. Conecta el sandbox: escanea el QR o envía el código al número indicado
4. Copia tu **Account SID** y **Auth Token** desde el Dashboard principal

En el sistema ve a **Configuración** e ingresa:
| Campo | Valor |
|-------|-------|
| Account SID | `ACxxxxxxxxxxxxxxxxxx` |
| Auth Token | tu token secreto |
| Número WhatsApp From | `whatsapp:+14155238886` |

> ⚠️ En modo sandbox, cada cliente debe enviar primero el código de activación al número de Twilio. Para producción sin este requisito, solicita un número aprobado en Twilio (~5 días).

---

## 📥 Importar clientes desde Excel

El Excel debe tener estas columnas (fila 1 = encabezados exactos):

```
NIT | DV | NATURALEZA | 1er NOMBRE | 2do NOMBRE | 1er APELLIDO | 2do APELLIDO | EMPRESA | DIRECCION | TELEFONO | MOVIL | EMAIL | GERENTE | COD. IDENTIDAD | COD. SOCIEDAD | COD. ACTIVIDAD | COD. ZONA | COD. MUNICIPIO | COD. PAIS
```

Ve a **Clientes → Importar Excel** y arrastra o selecciona el archivo.

---

## 📣 Enviar una campaña

**A todos los clientes:**
1. Campañas → Nueva Campaña
2. Escribe título y mensaje
3. Selecciona canal (Email o WhatsApp)
4. Selecciona "Todos los clientes" → Crear y Enviar

**A clientes específicos:**
1. Ve a Clientes → marca los checkboxes de los que quieras
2. Haz clic en **"Enviar campaña a seleccionados"**

**Variables disponibles en el mensaje:**
- `{nombre}` → nombre del cliente
- `{empresa}` → empresa del cliente

---

## 📋 Trazabilidad

En la sección **Trazabilidad** puedes:
- Ver todos los envíos con fecha y hora exacta
- Filtrar por campaña o estado (enviado / fallido)
- Ver el error específico cuando un mensaje falla

---

## 🗂️ Archivos del proyecto

```
autopremium-crm/
├── server.js          ← Servidor Node.js
├── package.json       ← Dependencias
├── autopremium.db     ← Base de datos (se crea al iniciar)
├── uploads/           ← Carpeta temporal (se crea automáticamente)
└── public/
    └── index.html     ← Interfaz web completa
```

---

## 🌐 Acceso desde otros dispositivos

- Misma red WiFi: `http://[IP-de-tu-PC]:3001`
- Para ver tu IP: ejecuta `ipconfig` en CMD y busca "Dirección IPv4"

---

*Auto Premium Service — Descubre la nueva era del servicio automotriz* 🚗
