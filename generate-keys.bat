@echo off
setlocal

echo.
echo ===================================
echo   NexBoost - Generateur de licences
echo ===================================
echo.

:: Quantite de cles a generer
set /p QUANTITE="Nombre de cles a generer [defaut: 1] : "
if "%QUANTITE%"=="" set QUANTITE=1

:: Duree en jours
echo.
echo Durees disponibles :
echo   31  = 1 mois (mensuel)
echo   365 = 1 an   (annuel)
set /p DUREE="Duree en jours [defaut: 31] : "
if "%DUREE%"=="" set DUREE=31

echo.
echo Generation de %QUANTITE% cle(s) de %DUREE% jour(s)...
echo.

node "%~dp0generate-keys.mjs" %QUANTITE% %DUREE% pro

echo.
pause
