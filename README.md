# Prime Bond Investment Platform - Backend

## Overview
Prime Bond is an online investment platform that allows users to register, verify their identity, make a registration payment, and invest in various plans with automated **monthly returns**. The backend is built with Node.js, Express, MongoDB, and supports payments via Stripe, NOWPayments (crypto), and cash (manual confirmation by admin).

## Features
- User registration and email verification
- Payment processing (card, crypto, cash)
- Investment plan management with monthly returns
- Automated monthly return calculation and payout scheduling
- Admin controls for managing users and confirming cash payments
- PDF receipt generation and email notifications

## Setup
1. **Install Dependencies**:
   ```bash
   npm install