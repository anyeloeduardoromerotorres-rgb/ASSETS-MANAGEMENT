# Deploy en Hostman

Este proyecto se despliega mejor como dos apps:

- Backend: Express/Node, carpeta raiz del repo.
- Frontend: Expo Web estatico, carpeta `frontend`.

## Backend

Opcion recomendada: crear una app desde el repo usando el `Dockerfile` de la raiz.

Variables de entorno requeridas en Hostman:

```bash
BD=mongodb+srv://USER:PASSWORD@HOST/DATABASE?retryWrites=true&w=majority
PORT=3000
```

El backend expone:

- Health check: `/health`
- API: `/api`
- Historial de capital: `/api/capital-history`

El backend tambien guarda un snapshot diario del capital total a las `00:05`
hora Lima. Para que esto funcione en Hostman, la app backend debe quedar
ejecutandose como proceso persistente con `npm start` o Docker.

Si Hostman detecta la app como Node sin Docker, usa:

```bash
npm ci --omit=dev
npm start
```

## Frontend

Crear una segunda app desde la carpeta `frontend`.

Variable de build requerida:

```bash
EXPO_PUBLIC_API_URL=https://TU_BACKEND_HOSTMAN_DOMAIN/api
```

Con Docker, Hostman debe usar `frontend/Dockerfile`. Sin Docker, el build es:

```bash
npm ci
npm run build:web
```

El resultado estatico queda en `frontend/dist`.

## Checklist antes de subir

1. Confirma que MongoDB Atlas permite conexiones desde Hostman.
2. Sube el repo a GitHub/GitLab/Bitbucket.
3. Crea primero el backend y prueba `https://TU_BACKEND/health`.
4. Prueba `https://TU_BACKEND/api/capital-history`; debe responder un arreglo.
5. Crea el frontend usando `EXPO_PUBLIC_API_URL=https://TU_BACKEND/api`.
6. Si cambias la URL del backend, vuelve a construir el frontend.
