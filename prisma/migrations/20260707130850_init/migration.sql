-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellOffer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "triggerProductId" TEXT,
    "triggerProductTitle" TEXT,
    "triggerParentProductId" TEXT,
    "triggerProductImage" TEXT,
    "upgradeProductId" TEXT,
    "upgradeProductTitle" TEXT,
    "upgradeParentProductId" TEXT,
    "upgradeProductImage" TEXT,
    "priceDifference" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpsellOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "thankYouWidgetEnabled" BOOLEAN NOT NULL DEFAULT true,
    "referralWidgetEnabled" BOOLEAN NOT NULL DEFAULT true,
    "discountWidgetEnabled" BOOLEAN NOT NULL DEFAULT true,
    "discountCode" TEXT NOT NULL DEFAULT 'NEXT10',
    "timerDuration" INTEGER NOT NULL DEFAULT 15,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpsellSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "featureType" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "offerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UpsellSettings_shop_key" ON "UpsellSettings"("shop");
