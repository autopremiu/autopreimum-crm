# Usa Node oficial
FROM node:18

# Carpeta de trabajo
WORKDIR /app

# Copia package.json
COPY package*.json ./

# Instala dependencias
RUN npm install

# Copia todo el proyecto
COPY . .

# Expone el puerto
EXPOSE 8080

# Comando para iniciar
CMD ["npm", "start"]