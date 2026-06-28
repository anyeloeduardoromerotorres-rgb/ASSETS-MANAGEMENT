# Deploy en Hostman

Este proyecto se despliega mejor como dos apps:

- Backend: Express/Node, carpeta raiz del repo.
- Frontend web: Expo Web estatico, carpeta `frontend`.

La app Android/APK se compila con EAS y se conecta al backend HTTPS de Hostman.

## Backend

Opcion recomendada: crear una app desde el repo usando el `Dockerfile` de la raiz.

Variables de entorno requeridas en Hostman:

```bash
BD=mongodb+srv://USER:PASSWORD@HOST/DATABASE?retryWrites=true&w=majority
PORT=3000
BACKGROUND_JOBS_ENABLED=true
BINANCE_API_KEY=...
BINANCE_SECRET_KEY=...
EXCHANGERATE_API_KEY=...
```

`BACKGROUND_JOBS_ENABLED=true` deja activos:

- actualizacion diaria de velas;
- snapshot diario de capital;
- scheduler de Trend Runner;
- escaneo diario de senales;
- monitoreo intradia de cierres.

El backend expone:

- Health check: `/health`
- API health: `/api/health`
- API general: `/api`
- Trend Runner: `/api/trend-runner`
- Historial de capital: `/api/capital-history`

Si Hostman detecta la app como Node sin Docker, usa:

```bash
npm ci --omit=dev
npm start
```

## Frontend web

Crear una segunda app desde la carpeta `frontend`.

Variable de build requerida:

```bash
EXPO_PUBLIC_API_URL=https://TU_BACKEND_HOSTMAN_DOMAIN/api
EXPO_PUBLIC_SHOW_DEBUG_TOOLS=false
```

Con Docker, Hostman debe usar `frontend/Dockerfile`. Sin Docker:

```bash
npm ci
npm run build:web
```

El resultado estatico queda en `frontend/dist`.

## APK Android de produccion

El perfil `production` en `frontend/eas.json` ya apunta a:

```bash
EXPO_PUBLIC_API_URL=https://hbsjajakwksnsj.duckdns.org/api
EXPO_PUBLIC_SHOW_DEBUG_TOOLS=false
ANDROID_USES_CLEARTEXT=false
```

Si el dominio final de Hostman cambia, actualiza `frontend/eas.json` antes de compilar.

Comandos:

```bash
cd frontend
npx eas build -p android --profile production --clear-cache --wait
```

## Checklist antes de subir

1. Confirma que MongoDB Atlas permite conexiones desde Hostman.
2. Confirma que las variables Binance estan configuradas en Hostman.
3. Sube el repo a GitHub/GitLab/Bitbucket.
4. Crea primero el backend y prueba `https://TU_BACKEND/health`.
5. Prueba `https://TU_BACKEND/api/health`.
6. Prueba `https://TU_BACKEND/api/trend-runner/capital`.
7. Crea el frontend usando `EXPO_PUBLIC_API_URL=https://TU_BACKEND/api`.
8. Compila el APK de produccion con el perfil `production`.
9. Abre la app una vez en el telefono para registrar el token push.
10. Verifica en MongoDB que exista un documento en `trendrunnerpushtokens`.
