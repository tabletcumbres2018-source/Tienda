-- Anuncios del listado de productos (se puede ejecutar varias veces sin duplicar)
-- Tipo 'banner'   : aparece en el carrusel superior y entre los resultados. Categoria = filtro que aplica al hacer clic (opcional).
-- Tipo 'producto' : producto patrocinado; sube al inicio del listado y lleva la etiqueta "Patrocinado".
-- Para apagar un anuncio:  UPDATE Anuncios SET Activo = 0 WHERE Id = ...
USE MegaStoreDB;
GO

IF OBJECT_ID('dbo.Anuncios') IS NULL
CREATE TABLE dbo.Anuncios (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    Tipo        NVARCHAR(10)  NOT NULL CONSTRAINT CK_Anuncios_Tipo CHECK (Tipo IN ('banner','producto')),
    Titulo      NVARCHAR(100) NULL,
    Texto       NVARCHAR(200) NULL,
    Boton       NVARCHAR(40)  NULL,
    Categoria   NVARCHAR(50)  NULL,
    Tema        NVARCHAR(10)  NOT NULL CONSTRAINT DF_Anuncios_Tema DEFAULT 'azul'
                CONSTRAINT CK_Anuncios_Tema CHECK (Tema IN ('azul','morado','verde','naranja')),
    ProductoId  INT NULL CONSTRAINT FK_Anuncios_Producto FOREIGN KEY REFERENCES dbo.Productos(Id),
    Orden       INT NOT NULL CONSTRAINT DF_Anuncios_Orden DEFAULT 0,
    Activo      BIT NOT NULL CONSTRAINT DF_Anuncios_Activo DEFAULT 1
);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Anuncios)
BEGIN
    INSERT INTO dbo.Anuncios (Tipo, Titulo, Texto, Boton, Categoria, Tema, Orden) VALUES
    ('banner', N'Envío GRATIS hasta 500 km', N'Escribe tu código postal al pagar y calculamos tu envío al instante.', NULL, NULL, 'verde', 1),
    ('banner', N'Tu sala en 4K', N'Descubre nuestra selección de televisores Smart TV.', N'Ver televisores', N'Televisores', 'azul', 2),
    ('banner', N'Música sin límites', N'Audífonos y bocinas con cancelación de ruido y Bluetooth 5.3.', N'Ver audio', N'Audio', 'morado', 3),
    ('banner', N'Rinde más con tu próxima laptop', N'Procesadores de última generación y SSD ultrarrápido.', N'Ver cómputo', N'Cómputo', 'naranja', 4);

    -- Productos patrocinados (uno por categoría principal)
    INSERT INTO dbo.Anuncios (Tipo, ProductoId, Orden)
    SELECT 'producto', Id, ROW_NUMBER() OVER (ORDER BY Id) FROM dbo.Productos WHERE Id IN (1, 8, 11, 16);
END
GO
