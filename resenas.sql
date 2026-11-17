-- Reseñas de productos (se puede ejecutar varias veces sin romper nada)
USE MegaStoreDB;
GO

IF OBJECT_ID('dbo.Resenas') IS NULL
CREATE TABLE dbo.Resenas (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    ProductoId    INT            NOT NULL CONSTRAINT FK_Resenas_Producto FOREIGN KEY REFERENCES dbo.Productos(Id),
    ClienteNombre NVARCHAR(100)  NOT NULL,
    ClienteCorreo NVARCHAR(150)  NOT NULL,
    Calificacion  TINYINT        NOT NULL CONSTRAINT CK_Resenas_Calif CHECK (Calificacion BETWEEN 1 AND 5),
    Comentario    NVARCHAR(500)  NOT NULL,
    Fecha         DATETIME2      NOT NULL CONSTRAINT DF_Resenas_Fecha DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_Resenas_UnaPorCliente UNIQUE (ProductoId, ClienteCorreo)   -- una reseña por cliente y producto
);
GO

-- Corrección de títulos: "Televisore ..." -> "Televisor ..."
UPDATE dbo.Productos SET Titulo = REPLACE(Titulo, N'Televisore ', N'Televisor ') WHERE Titulo LIKE N'Televisore %';
GO
