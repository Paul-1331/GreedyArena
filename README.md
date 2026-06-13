# GreedyArena

Vite + React (Frontend) & Express + Prisma + PostgreSQL (Backend).

This is a comprehensive, full-stack quiz and multiplayer arena platform. It features real-time WebSocket synchronization, global match timers, and a custom rating system (Glicko-2) for Official Wars.

## Repository Structure

This is a monorepo containing both the frontend and backend applications.

- `/frontend` - The React application powered by Vite, TailwindCSS, and shadcn/ui.
- `/backend` - The Node.js Express server utilizing Prisma ORM and Socket.io.

## Local Development

### Prerequisites

- Node.js 20+
- npm (or Bun)
- A local PostgreSQL database (or a cloud provider like Neon)

### 1. Database Setup

Create a PostgreSQL database and start it up. 

Navigate to the `backend` folder and configure your environment variables:

```sh
cd backend
# Create a .env file based on the example
```

Inside `backend/.env`, you must provide the following keys:
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/greedy_arena"
JWT_SECRET="your_secure_random_string_here"
FRONTEND_URL="http://localhost:8080"
PORT=4000
```

Push the Prisma schema to your database:
```sh
npx prisma db push
```

*(Note: If you are using a pooled Neon connection string, make sure to use a Direct connection string for `npx prisma db push`)*

### 2. Start the Backend

While still inside the `/backend` folder:

```sh
npm install
npm run dev
```
The backend server will start on port `4000`.

### 3. Start the Frontend

Open a new terminal window and navigate to the `/frontend` folder:

```sh
cd frontend
npm install
```

Configure your frontend environment variables in a `.env` file:
```env
VITE_API_URL=http://localhost:4000
```

Start the Vite development server:
```sh
npm run dev
```

## Admin Utilities

This repository includes a script to easily grant users Admin privileges from the command line without having to manually execute SQL queries.

To make a user an admin:
```sh
cd backend
node scripts/makeAdmin.js your.email@example.com
```
*Make sure the user is already registered via the web interface before running this command.*

## Deployment Guide

This repository is designed to be deployed using continuous integration platforms like Vercel and Render.

### 1. Deploy the Database (Neon)
1. Create a Neon project and get the pooled connection string.
2. Run `npx prisma db push` locally using your Neon direct connection string to create the tables.

### 2. Deploy the Backend (Render)
1. Import this repository into Render as a **Web Service**.
2. **Root Directory**: `backend`
3. **Build Command**: `npm install && npx prisma generate`
4. **Start Command**: `npm run start`
5. **Environment Variables**: Add `DATABASE_URL` (pooled), `JWT_SECRET`, and `FRONTEND_URL` (set to `*` initially, then update to your Vercel URL later).

### 3. Deploy the Frontend (Vercel)
1. Import this repository into Vercel as a **Project**.
2. **Root Directory**: `frontend`
3. **Framework Preset**: Vite
4. **Environment Variables**: Add `VITE_API_URL` pointing to your deployed Render URL.
5. Deploy!

## Scripts

**Backend:**
- `npm run dev` - start local server with hot-reload
- `npm run start` - start production server

**Frontend:**
- `npm run dev` - start local dev server
- `npm run build` - production build
- `npm run preview` - preview production build
