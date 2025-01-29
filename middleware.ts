import { clerkMiddleware } from '@clerk/nextjs/server'

export default clerkMiddleware()

export const config = {
  matcher: [
    // Regular routes
    '/((?!.+\\.[\\w]+$|_next).*)',
    // Specific chat routes
    '/chat/:path*',
    '/companion/:path*',
    // API routes
    '/(api|trpc)(.*)'
  ],
};