**Prime Bond Investment Platform Backend**

Overview

Prime Bond is a robust investment platform backend designed to facilitate user registration, KYC verification, investment plan selection, payment processing, and return on investment (ROI) management. Built with Node.js and Express, it integrates with MongoDB for data persistence, CCAvenue and Stripe for payment processing, and Cloudinary for file uploads. The platform supports both user and admin functionalities, including secure authentication, automated email notifications, receipt generation, and scheduled ROI payouts.

Features

**User Registration and Authentication**

User Signup/Login: Users can register with email, password, and personal details, and log in securely using JWT-based authentication (authController.js, authMiddleware.js).

Google OAuth: Supports Google authentication for seamless user login (authController.js).

Email Verification: Sends verification emails with a unique token to confirm user email addresses (emailService.js).

Password Reset: Allows users to reset passwords via secure email links (emailService.js).

**KYC (Know Your Customer) Verification**

Document Upload: Users can upload KYC documents (JPEG, PNG, PDF) using Multer, stored locally and optionally on Cloudinary (upload.js, cloudinary.js, kycController.js).

Verification Process: Admins review and approve/reject KYC submissions, updating user verification status (kycController.js, adminController.js).

**Investment Management**

Plan Selection: Users can choose investment plans with defined amounts and ROI rates (investmentController.js).

Investment Creation: Supports creating investments linked to user accounts, with details stored in MongoDB (investmentController.js).

**Payment Processing**

CCAvenue Integration: Handles secure payment processing with AES-128-CBC encryption/decryption for transactions (cryptoCCAvenue.js, ccavutil.js, paymentController.js).

Stripe Integration: Supports additional payment processing via Stripe for flexibility (package.json).

Receipt Generation: Generates PDF receipts for registration and investment payments, sent via email with professional formatting (paymentUtils.js).

**ROI (Return on Investment) Management**

Return Calculation: Calculates returns based on investment amount, rate, and payout option (monthly or annually) (calculateReturn.js).

Payout Scheduling: Automates ROI payouts using a cron-based scheduler (returnScheduler.js, roiController.js).

Next Payout Date: Determines the next payout date based on the selected payout option (calculateReturn.js).

**Admin Functionalities**

Dashboard Statistics: Provides admins with insights into user counts, investments, and payments (adminController.js).

Payment Confirmation: Admins can confirm or reject payments, updating transaction statuses (adminController.js).

KYC Management: Admins review and manage KYC submissions (kycController.js).

**Additional Features**

**Contact Form**: Handles user inquiries via a contact form, processed through email or database storage (contactController.js).

**User Reviews**: Allows users to submit reviews, managed via dedicated routes (reviewRoutes.js).

**Banking Configuration**: Supports country-specific banking details for withdrawals (e.g., IFSC for India, IBAN for Germany) (bankingConfig.js).



**Technologies Used**

**Node.js**: JavaScript runtime for building the backend.

**Express.js**: Web framework for handling routes and middleware.

**MongoDB/Mongoose**: Database and ORM for data persistence.

**JWT (jsonwebtoken)**: Secure user authentication.

**Bcryptjs**: Password hashing for secure storage.

**Cloudinary**: Cloud storage for KYC document uploads.

**Multer**: File upload handling for KYC documents.

**Nodemailer**: Email sending for verification, password reset, and receipts.

**PDFKit**: PDF generation for payment receipts.

**Node-cron**: Scheduled tasks for ROI payouts.

**CCAvenue & Stripe**: Payment gateways for secure transactions.

**Crypto**: AES-128-CBC encryption/decryption for CCAvenue payments.

**Dotenv**: Environment variable management.

**CORS**: Cross-origin resource sharing for frontend integration.

**Google-auth-library**: Google OAuth integration.

**Node-fetch**: HTTP requests for external APIs.



**Payment Gateways**

**CCAvenue**: Primary payment gateway for processing registration and investment payments. Uses AES-128-CBC encryption with MD5-hashed keys for secure transactions (cryptoCCAvenue.js, ccavutil.js).

**Stripe**: Secondary payment gateway for additional payment processing flexibility (package.json, assumed integration in paymentController.js).

**Gateway Usage**

**Registration**: Users pay a registration fee via CCAvenue or Stripe, with receipts generated and emailed (paymentController.js, paymentUtils.js).

**Investment**: Investment payments are processed securely, with transaction details stored and receipts sent (investmentController.js, paymentUtils.js).

**ROI Payouts**: ROI calculations and payouts are automated, with banking details validated per country-specific requirements (roiController.js, bankingConfig.js).



**Project Structure**

**primebond-backend/
├── assets/                   # Static assets (e.g., logo, paid seal)
├── controllers/              # Request handling logic
│   ├── adminController.js
│   ├── authController.js
│   ├── contactController.js
│   ├── investmentController.js
│   ├── kycController.js
│   ├── paymentController.js
│   └── roiController.js
├── jobs/                     # Scheduled tasks
│   └── returnScheduler.js
├── models/                   # MongoDB schemas
│   └── auth_schema.js
├── routes/                   # API routes
│   ├── adminRoutes.js
│   ├── authRoutes.js
│   ├── contactRoutes.js
│   ├── investmentRoutes.js
│   ├── kyc.js
│   ├── paymentRoutes.js
│   ├── reviewRoutes.js
│   └── roiRoutes.js
├── utils/                    # Utility functions
│   ├── bankingConfig.js
│   ├── calculateReturn.js
│   ├── ccavutil.js
│   ├── cryptoCCAvenue.js
│   ├── emailService.js
│   ├── paymentUtils.js
│   └── upload.js
├── uploads/                  # Local storage for KYC documents
│   └── kyc/
├── cloudinary.js            # Cloudinary configuration
├── authMiddleware.js        # JWT authentication middleware
├── server.js                # Main server setup
├── package.json             # Project dependencies and scripts
└── .env                     # Environment variables (not in repo)**



Setup Instructions





**Clone the Repository**:

git clone https://github.com/your-username/primebond-backend.git
cd primebond-backend



**Install Dependencies:**

npm install



**Set Up Environment Variables: Create a .env file in the root directory with the following variables:**

MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
EMAIL_HOST=your_email_host
EMAIL_PORT=your_email_port
EMAIL_SECURE=true_or_false
EMAIL_ID=your_email_id
EMAIL_APP_PASSWORD=your_email_app_password
FRONTEND_URL=your_frontend_url
CCAVENUE_WORKING_KEY=your_ccavenue_working_key
STRIPE_SECRET_KEY=your_stripe_secret_key
PORT=5000

**Run the Application:**

Development mode (with Nodemon):

npm run dev

Production mode:

npm start

Access the API: The server runs on http://localhost:5000 . Use endpoints like /api/auth, /api/pay, /api/investment, etc.


**API Endpoints**

Authentication: /api/auth (signup, login, Google OAuth, email verification, password reset)

Payments: /api/pay (initiate payments, handle CCAvenue/Stripe responses)

Investments: /api/investment (create/view investments)

KYC: /api/kyc (submit/review KYC documents)

ROI: /api/roi (view ROI details, payout schedules)

Admin: /api/admin (dashboard stats, payment confirmation, KYC management)

Reviews: /api/reviews (submit/view user reviews)

Contact: /api/contact (handle contact form submissions)



**Security Considerations**

JWT Authentication: Ensures secure access to protected routes (authMiddleware.js).

Password Hashing: Uses Bcryptjs for secure password storage (authController.js).

File Upload Restrictions: Limits KYC uploads to JPEG, PNG, and PDF (upload.js).

Encryption: CCAvenue payments use AES-128-CBC encryption (cryptoCCAvenue.js, ccavutil.js).

Email Security: Uses app-specific passwords for email sending; TLS should be set to rejectUnauthorized: true in production (emailService.js).

**Contributing**

Contributions are welcome! Please submit a pull request or open an issue to discuss improvements or bug fixes.

**License**

This project is licensed under the ISC License.
