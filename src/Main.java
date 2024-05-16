import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        List<Double> numeros = new ArrayList<>();

        System.out.println("Insira os números (termine com um ponto final):");

        // Lê os números do utilizador até encontrar um ponto final
        while (true) {
            String input = scanner.nextLine().trim();
            if (input.equals(".")) {
                break;
            }
            try {
                double num = Double.parseDouble(input);
                numeros.add(num);
            } catch (NumberFormatException e) {
                System.out.println("Entrada inválida. Por favor, insira uma sequência de números ou um ponto final caso pretenda terminar.");
            }
        }

        // Verifica se a listade números está vazia
        if (numeros.isEmpty()) {
            System.out.println("Nenhum número foi inserido.");
            return;
        }

        // Calcula a média
        double media = NumberUtils.calcularMedia(numeros);
        System.out.println("Média: " + media);

        // Calcula a mediana
        double mediana = NumberUtils.calcularMediana(numeros);
        System.out.println("Mediana: " + mediana);

        // Obtém a moda
        ModaResultado modaResultado = NumberUtils.calcularModa(numeros);
        List<Double> moda = ModaResultado.getModa();
        if (moda.isEmpty()) {
            System.out.println("Moda: Não existe. Cada elemento aparece apenas 1 vez.");
        } else {
            System.out.println("Moda: " + moda + " - " + modaResultado.getFreqMaxima() + "x");
        }


        // Ordena a lista em ordem crescente
        List<Double> numerosCrescente = new ArrayList<>(numeros);
        System.out.println("Pretende obter a ordenação da sequência de números por ordem Crescente (1,2,3,...) ou Decrescente (10,9,8,...) ?");
        Scanner scannerCrescente = new Scanner(System.in);
        String ordenacao = scannerCrescente.nextLine();

        if (Objects.equals(ordenacao, "crescente") || Objects.equals(ordenacao, "Crescente")|| Objects.equals(ordenacao, "CRESCENTE")) {
            NumberUtils.ordenarLista(numerosCrescente, true);
            System.out.println("Lista em ordem crescente: " + numerosCrescente);
        } else {
            // Ordena a lista em ordem decrescente
            List<Double> numerosDecrescente = new ArrayList<>(numeros);
            NumberUtils.ordenarLista(numerosDecrescente, false);
            System.out.println("Lista em ordem decrescente: " + numerosDecrescente);

            scanner.close();
        }


    }
}
